package app.capgo.capacitor.fastsql;

import static org.junit.Assert.assertEquals;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class SQLDatabaseTest {

    @Test
    public void queriesUseSqliteMetadataAndTypedParameters() throws Exception {
        File file = File.createTempFile("fast-sql", ".db");
        file.deleteOnExit();
        SQLDatabase database = new SQLDatabase(file.getAbsolutePath(), false, false);
        try {
            database.execute("CREATE TABLE sample (value BLOB)", new JSArray());
            JSObject blob = new JSObject();
            blob.put("_type", "binary");
            blob.put("_data", "AQID");
            JSArray bindings = new JSArray();
            bindings.put(blob);
            database.execute("INSERT INTO sample VALUES (?)", bindings);
            JSObject result = database.execute(
                "/* leading comment */ WITH matches AS (SELECT value FROM sample WHERE value = ?) SELECT * FROM matches",
                bindings
            );
            assertEquals(1, result.getJSONArray("rows").length());
            assertEquals("AQID", result.getJSONArray("rows").getJSONObject(0).getJSONObject("value").getString("_data"));
            JSArray types = new JSArray();
            types.put(true);
            types.put(1.25);
            types.put(JSONObject.NULL);
            result = database.execute("SELECT typeof(?) AS b, typeof(?) AS n, typeof(?) AS nil", types);
            JSONObject row = result.getJSONArray("rows").getJSONObject(0);
            assertEquals("integer", row.getString("b"));
            assertEquals("real", row.getString("n"));
            assertEquals("null", row.getString("nil"));
        } finally {
            database.close();
        }
    }
}
