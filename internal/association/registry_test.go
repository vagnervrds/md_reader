package association

import (
	"runtime"
	"testing"
)

func TestAssociation(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows only test")
	}

	status := CheckStatus()
	if !status.Supported {
		t.Fatalf("Expected association to be supported on Windows")
	}

	regRes, err := Register()
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}
	if !regRes.Success {
		t.Fatalf("Expected Register success to be true")
	}

	statusAfter := CheckStatus()
	if !statusAfter.IsAssociated {
		t.Fatalf("Expected IsAssociated to be true after Register")
	}
}
