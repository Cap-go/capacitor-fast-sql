package app.capgo.capacitor.fastsql;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import com.getcapacitor.JSArray;
import java.io.File;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ReadOnlyDatabaseTest {

    @Test
    public void readOnlyOpenAllowsReadsAndRejectsWrites() throws Exception {
        File file = File.createTempFile("fast-sql-readonly", ".db");
        file.deleteOnExit();
        SQLDatabase writable = new SQLDatabase(file.getAbsolutePath(), false, false);
        writable.execute("CREATE TABLE sample (value TEXT)", new JSArray());
        writable.close();
        SQLDatabase readOnly = new SQLDatabase(file.getAbsolutePath(), true, false, true);
        try {
            assertEquals(
                1,
                readOnly.execute("SELECT name FROM sqlite_master WHERE name = 'sample'", new JSArray()).getJSONArray("rows").length()
            );
            assertThrows(Exception.class, () -> readOnly.execute("INSERT INTO sample VALUES ('x')", new JSArray()));
        } finally {
            readOnly.close();
        }
    }
}
