package app.capgo.capacitor.fastsql;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSArray;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class HttpRequestJsonParamsTest {

    @Test
    public void convertRequestParam_handlesNullBooleanStringAndNumbers() throws Exception {
        assertEquals(JSONObject.NULL, HttpRequestJsonParams.convertRequestParam(JSONObject.NULL));
        assertEquals(true, HttpRequestJsonParams.convertRequestParam(true));
        assertEquals("text", HttpRequestJsonParams.convertRequestParam("text"));
        assertEquals(42L, HttpRequestJsonParams.convertRequestParam(42));
        assertEquals(3L, HttpRequestJsonParams.convertRequestParam(3.14));
    }

    @Test
    public void convertRequestParam_truncatesDecimalLikeGsonGetAsLong() {
        assertEquals(9L, HttpRequestJsonParams.convertRequestParam(9.99));
    }

    @Test
    public void convertRequestParam_jsonObjectValuesUseGetAsStringSemantics() throws Exception {
        JSONObject obj = new JSONObject("{\"s\":\"hello\",\"n\":7,\"b\":false}");

        JSONObject out = (JSONObject) HttpRequestJsonParams.convertRequestParam(obj);
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
        assertEquals(Long.MAX_VALUE, HttpRequestJsonParams.gsonStyleLongFromNumberString("1e20"));
    }

    @Test
    public void malformedRequestJson_throws() {
        try {
            new JSONTokener("{").nextValue();
            assertTrue("expected JSONException", false);
        } catch (JSONException expected) {
            // Same error path as invalid Gson bodies surfacing as request failures
        }
    }

    @Test
    public void convertRequestParam_skipsUnsupportedArrayElements() throws Exception {
        JSONArray nested = new JSONArray();
        nested.put(1);
        assertNull(HttpRequestJsonParams.convertRequestParam(nested));

        JSONArray input = new JSONArray();
        JSONArray nestedInInput = new JSONArray();
        nestedInInput.put(1);
        input.put(nestedInInput);
        input.put("kept");

        JSArray params = new JSArray();
        HttpRequestJsonParams.populateJsArrayFromParamsJson(input, params);
        assertEquals(1, params.length());
        assertEquals("kept", params.get(0));
    }

    @Test
    public void convertRequestParam_rejectsNestedObjectFieldsLikeGson() throws Exception {
        JSONObject obj = new JSONObject("{\"meta\":{\"a\":1}}");
        try {
            HttpRequestJsonParams.convertRequestParam(obj);
            assertTrue("expected IllegalStateException", false);
        } catch (IllegalStateException expected) {
            // Gson getAsString() on nested objects throws
        }
    }
}
