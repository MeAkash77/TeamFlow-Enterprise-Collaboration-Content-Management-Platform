package dev.teamflow.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/**
 * Append-only audit log. Internal-only: guarded by a shared key and never exposed through NGINX.
 */
@RestController
@RequestMapping("/internal/audit")
public class AuditController {

    public record AuditEvent(
        @NotBlank String action,
        @NotBlank String entity,
        String entityId,
        String actorId,
        String actorEmail,
        String ip,
        String requestId,
        Map<String, Object> detail) {}

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final byte[] key;

    public AuditController(JdbcTemplate jdbc, ObjectMapper mapper, @Value("${teamflow.internal-key}") String key) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.key = key.getBytes(StandardCharsets.UTF_8);
    }

    private void authorize(String provided) {
        byte[] p = provided == null ? new byte[0] : provided.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(key, p)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "bad key");
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@RequestHeader(value = "X-Internal-Key", required = false) String k,
                                      @Valid @RequestBody AuditEvent e) throws JsonProcessingException {
        authorize(k);
        String detail = mapper.writeValueAsString(e.detail() == null ? Map.of() : e.detail());
        jdbc.update("""
            insert into audit_logs (action, entity, entity_id, actor_id, actor_email, ip, request_id, detail)
            values (?,?,?,?,?,?,?,?::jsonb)""",
            e.action(), e.entity(), e.entityId(), e.actorId(), e.actorEmail(), e.ip(), e.requestId(), detail);
        return Map.of("status", "recorded");
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestHeader(value = "X-Internal-Key", required = false) String k,
                                          @RequestParam(defaultValue = "50") int limit,
                                          @RequestParam(required = false) String entity) {
        authorize(k);
        int n = Math.max(1, Math.min(limit, 500));
        return jdbc.queryForList("""
            select id, action, entity, entity_id as "entityId", actor_email as "actorEmail", ip,
                   request_id as "requestId", detail::text as detail, created_at as "createdAt"
            from audit_logs where (?::text is null or entity = ?) order by id desc limit ?""", entity, entity, n);
    }

    @GetMapping("/summary")
    public List<Map<String, Object>> summary(@RequestHeader(value = "X-Internal-Key", required = false) String k) {
        authorize(k);
        return jdbc.queryForList("""
            select action, count(*) as count from audit_logs
            where created_at > now() - interval '24 hours' group by action order by count desc""");
    }
}
