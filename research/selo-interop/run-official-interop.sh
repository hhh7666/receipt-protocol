#!/usr/bin/env bash
# Real Selo CLI + RP Store API integration. Synthetic signer, NOT agent-execution evidence.
set -Eeuo pipefail
if [[ $# -ne 1 ]]; then
  echo 'usage: run-official-interop.sh OUTPUT_DIRECTORY' >&2
  exit 2
fi
for bin in git go node sha256sum; do command -v "$bin" >/dev/null || { echo "missing: $bin" >&2; exit 2; }; done
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELO_REF='5a4902667421dee0b67d2e2ce8b109d4cd1ccf6a'
OUT="$(realpath -m "$1")"
mkdir -p "$OUT"
WORK="$(mktemp -d)"
PHASE="preflight"
on_exit() {
  local code=$?
  printf 'exit_code=%s\nupstream_commit=%s\nphase=%s\n' "$code" "$SELO_REF" "$PHASE" > "$OUT/status.txt"
  # Include failure logs and final status in the manifest, even on early exit.
  find "$OUT" -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 -r sha256sum > "$OUT/SHA256SUMS"
  rm -rf "$WORK"
}
trap on_exit EXIT
printf 'upstream_commit=%s\nsigner_identity=test-generated-in-process\nindependent_signer_authentication=false\nstore_scope=reference-in-memory-api\nagent_execution_attested=false\n' "$SELO_REF" | tee "$OUT/provenance.txt"
node --version | tee -a "$OUT/provenance.txt"
go version | tee -a "$OUT/provenance.txt"
sha256sum "$SCRIPT_DIR/official-fixture/main.go" "$SCRIPT_DIR/run-official-interop.sh" > "$OUT/source-sha256.txt"
PHASE="source_acquisition"
UPSTREAM="$WORK/selo"
if [[ -n "${SELO_SOURCE_DIR:-}" ]]; then
  [[ -d "$SELO_SOURCE_DIR/.git" ]] || { echo 'SELO_SOURCE_DIR must be a git checkout' >&2; exit 2; }
  cp -a "$SELO_SOURCE_DIR" "$UPSTREAM"
else
  git clone --quiet https://github.com/C1-run/Selo.git "$UPSTREAM" 2> "$OUT/clone.stderr"
fi
PHASE="upstream_checkout"
git -C "$UPSTREAM" checkout --quiet --detach "$SELO_REF"
ACTUAL="$(git -C "$UPSTREAM" rev-parse HEAD)"
[[ "$ACTUAL" == "$SELO_REF" ]] || { echo "upstream mismatch: $ACTUAL" >&2; exit 1; }
PHASE="upstream_build_and_fixture"
mkdir -p "$UPSTREAM/cmd/rp-interop-fixture" "$OUT/fixture"
cp "$SCRIPT_DIR/official-fixture/main.go" "$UPSTREAM/cmd/rp-interop-fixture/main.go"
(
  cd "$UPSTREAM"
  go build -o "$OUT/selo" ./cmd/selo 2> "$OUT/go-build.stderr"
  go run ./cmd/rp-interop-fixture "$OUT/fixture" > "$OUT/fixture-generator.stdout" 2> "$OUT/fixture-generator.stderr"
)
PHASE="positive_official_verification"
PIN="$(tr -d '\r\n' < "$OUT/fixture/fingerprint.txt")"
"$OUT/selo" verify "$OUT/fixture/native.json" --pubkey "$OUT/fixture/trusted.pub" --json > "$OUT/native-verdict.json" 2> "$OUT/native-verify.stderr"
"$OUT/selo" verify "$OUT/fixture/dsse.json" --pubkey "$OUT/fixture/trusted.pub" --json > "$OUT/dsse-verdict.json" 2> "$OUT/dsse-verify.stderr"
PHASE="store_api_roundtrip"
node "$SCRIPT_DIR/selo-roundtrip.mjs" \
  --native "$OUT/fixture/native.json" --dsse "$OUT/fixture/dsse.json" \
  --selo "$OUT/selo" --pubkey "$OUT/fixture/trusted.pub" \
  --pin-fingerprint "$PIN" --out "$OUT/store-roundtrip" > "$OUT/store-roundtrip.stdout" 2> "$OUT/store-roundtrip.stderr"
PHASE="negative_fixture_construction"
node --input-type=module - "$OUT" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out=process.argv[2];
const native=JSON.parse(readFileSync(join(out,'fixture/native.json'),'utf8'));
native.signature='AA==';
writeFileSync(join(out,'native-tampered.json'),JSON.stringify(native)+'\n');
const env=JSON.parse(readFileSync(join(out,'fixture/dsse.json'),'utf8'));
env.signatures[0].sig='AA==';
writeFileSync(join(out,'dsse-tampered.json'),JSON.stringify(env)+'\n');
NODE
PHASE="negative_official_verification"
for kind in native dsse; do
  set +e
  "$OUT/selo" verify "$OUT/$kind-tampered.json" --pubkey "$OUT/fixture/trusted.pub" --json > "$OUT/$kind-negative-verdict.json" 2> "$OUT/$kind-negative.stderr"
  verify_rc=$?
  set -e
  printf '%s_negative_exit=%s\n' "$kind" "$verify_rc" >> "$OUT/negative-exit-codes.txt"
  if [[ "$verify_rc" -ne 1 ]]; then
    echo "FAIL: tampered $kind verifier exit $verify_rc (expected exactly 1)" >&2
    exit 1
  fi
done
PHASE="negative_structured_verdict_validation"
node --input-type=module - "$OUT" <<'NODE'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv[2];
for (const [kind, expectedError] of [
  ['native', 'signature mismatch'],
  ['dsse', 'DSSE signature invalid']
]) {
  const result = JSON.parse(readFileSync(join(out, kind + '-negative-verdict.json'), 'utf8'));
  if (result.valid !== false || result.pubkey_pinned !== true ||
      result.pubkey_match !== true || !Array.isArray(result.errors) ||
      !result.errors.some(e => typeof e === 'string' && e.includes(expectedError))) {
    throw Error(`FAIL: ${kind} negative verdict did not prove expected signature rejection`);
  }
  console.log(`PASS: ${kind} rejected by official verifier with pinned signer and signature-specific error`);
}
NODE
PHASE="final_report_validation"
node --input-type=module - "$OUT" <<'NODE'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const out=process.argv[2];
const report=JSON.parse(readFileSync(join(out,'store-roundtrip/report.json'),'utf8'));
if (!report.pass || report.cases.length !== 2 || !report.cases.every(c=>c.pass)) process.exit(1);
console.log('PASS: official Selo signer + verifier, RP Store API, two negative signatures');
NODE
PHASE="complete"
