package app.capgo.capacitor.fastsql;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import org.junit.Test;

public class HTTPOriginTest {

    @Test
    public void normalizesDefaultPortsAndHostCase() throws Exception {
        SQLHTTPServer server = new SQLHTTPServer(new HashMap<>(), "https://APP.example:443/path");
        try {
            assertTrue(server.acceptsOrigin("https://app.example"));
        } finally {
            server.stop();
        }
    }

    @Test
    public void acceptsOnlyConfiguredOriginOrNonBrowserCallers() throws Exception {
        SQLHTTPServer server = new SQLHTTPServer(new HashMap<>(), "https://app.example:8443/path?query=true");
        try {
            assertTrue(server.acceptsOrigin("https://app.example:8443"));
            assertTrue(server.acceptsOrigin(null));
            assertFalse(server.acceptsOrigin("https://app.example"));
            assertFalse(server.acceptsOrigin("https://app.example:8443.attacker.test"));
            assertFalse(server.acceptsOrigin("null"));
        } finally {
            server.stop();
        }
    }
}
