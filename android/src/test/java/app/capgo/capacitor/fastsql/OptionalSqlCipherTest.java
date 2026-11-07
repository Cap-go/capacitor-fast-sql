package app.capgo.capacitor.fastsql;

import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class OptionalSqlCipherTest {

    @Test
    public void encryptedConnectRejectsCleanlyWhenSqlCipherIsAbsent() {
        assertThrows(ClassNotFoundException.class, () -> Class.forName("net.zetetic.database.sqlcipher.SQLiteDatabase"));
        CapgoCapacitorFastSqlPlugin plugin = new CapgoCapacitorFastSqlPlugin() {
            @Override
            public Context getContext() {
                return RuntimeEnvironment.getApplication();
            }
        };
        JSObject options = new JSObject();
        options.put("database", "optional-cipher");
        options.put("encrypted", true);
        options.put("encryptionKey", "test-only-key");
        AtomicReference<String> rejection = new AtomicReference<>("");
        PluginCall call = new PluginCall(null, "CapgoCapacitorFastSql", "test", "connect", options) {
            @Override
            public void reject(String message, String code, Exception error, JSObject data) {
                rejection.set(message);
            }
        };
        plugin.connect(call);
        assertTrue(rejection.get().startsWith("Encryption is not available."));
    }
}
