package app.capgo.capacitor.fastsql;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSArray;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class HttpRequestJsonParamsTest {

    @Test
    public void populateParams_handlesNullBooleanStringAndNumbers() throws Exception {
        JSONArray input = new JSONArray();
        input.put(JSONObject.NULL);
        input.put(true);
        input.put("text");
        input.put(42);
        input.put(3.14);

        JSArray params = new JSArray();
        HttpRequestJsonParams.populateJsArrayFromParamsJson(input, params);

        assertEquals(5, params.length());
        assertEquals(JSONObject.NULL, params.get(0));
        assertEquals(true, params.get(1));
        assertEquals("text", params.get(2));
        assertEquals(42L, ((Number) params.get(3)).longValue());
        assertEquals(3L, ((Number) params.get(4)).longValue());
    }

    @Test
    public void populateParams_truncatesDecimalLikeGsonGetAsLong() throws Exception {
        JSArray params = new JSArray();
        HttpRequestJsonParams.appendParam(params, 9.99);
        assertEquals(9L, params.get(0));
    }

    @Test
    public void populateParams_jsonObjectValuesUseGetAsStringSemantics() throws Exception {
        JSONObject obj = new JSONObject();
        obj.put("s", "hello");
        obj.put("n", 7);
        obj.put("b", false);

        JSArray params = new JSArray();
        HttpRequestJsonParams.appendParam(params, obj);

        JSONObject out = (JSONObject) params.get(0);
        assertEquals("hello", out.getString("s"));
        assertEquals("7", out.getString("n"));
        assertEquals("false", out.getString("b"));
    }

    @Test
    public void elementGetAsString_rejectsNull() {
        try {
            HttpRequestJsonParams.elementGetAsString(JSONObject.NULL);
            assertTrue("expected IllegalStateException", false);
        } catch (IllegalStateException expected) {
            // Gson-compatible
        }
    }

    @Test
    public void gsonStyleLongFromNumberString_parsesIntegerAndTruncatesDecimal() {
        assertEquals(100L, HttpRequestJsonParams.gsonStyleLongFromNumberString("100"));
        assertEquals(3L, HttpRequestJsonParams.gsonStyleLongFromNumberString("3.14"));
    }

    @Test
    public void malformedRequestJson_throws() {
        try {
            new JSONObject("{not json");
            assertTrue("expected JSONException", false);
        } catch (org.json.JSONException expected) {
            // Same error path as invalid Gson bodies surfacing as request failures
        }
    }

    @Test
    public void populateParams_skipsUnsupportedArrayElements() throws Exception {
        JSONArray input = new JSONArray();
        input.put(new JSONArray().put(1));
        input.put("kept");

        JSArray params = new JSArray();
        HttpRequestJsonParams.populateJsArrayFromParamsJson(input, params);

        assertEquals(1, params.length());
        assertEquals("kept", params.get(0));
    }
}
