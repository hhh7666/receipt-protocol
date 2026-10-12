// Test-only fixture generator. This source is copied into the pinned upstream
// Selo module, so its internal/receipt package is used directly.
// It does not attest to any real agent execution or independent signer custody.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/C1-run/selo/internal/receipt"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: rp-interop-fixture OUT_DIR")
		os.Exit(2)
	}
	out := os.Args[1]
	if err := os.MkdirAll(out, 0755); err != nil {
		panic(err)
	}
	now := time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC)
	r := receipt.ForgeReceipt{
		ReceiptID:  "rp-selo-official-fixture-1",
		TaskID:     "rp-selo-official-fixture-1",
		Verdict:    receipt.VerdictSuccess,
		StartedAt:  now,
		FinishedAt: now.Add(time.Second),
		ExitCode:   0,
	}
	if _, err := receipt.SignReceipt(&r); err != nil {
		panic(err)
	}
	envelope, err := receipt.ExportInToto(&r)
	if err != nil {
		panic(err)
	}
	fp, err := receipt.PublicKeyFingerprint(r.PublicKey)
	if err != nil {
		panic(err)
	}
	writeJSON := func(name string, value any) {
		b, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			panic(err)
		}
		b = append(b, '\n')
		if err := os.WriteFile(filepath.Join(out, name), b, 0644); err != nil {
			panic(err)
		}
	}
	writeJSON("native.json", &r)
	writeJSON("dsse.json", envelope)
	if err := os.WriteFile(filepath.Join(out, "trusted.pub"), []byte(r.PublicKey+"\n"), 0644); err != nil {
		panic(err)
	}
	if err := os.WriteFile(filepath.Join(out, "fingerprint.txt"), []byte(fp+"\n"), 0644); err != nil {
		panic(err)
	}
	fmt.Println("generated signed Selo-native and DSSE fixtures using upstream internal/receipt")
}
