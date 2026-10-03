package dev.teamflow.audit;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class AuditEventTest {
    @Test
    void recordKeepsFields() {
        var e = new AuditController.AuditEvent("document.create", "document", "1", "u1", "a@b.c", "127.0.0.1", "r1", null);
        assertEquals("document.create", e.action());
        assertEquals("document", e.entity());
    }
}
