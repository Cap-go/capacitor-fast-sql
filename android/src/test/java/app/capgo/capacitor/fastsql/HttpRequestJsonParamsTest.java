package app.capgo.capacitor.fastsql;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSArray;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
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
    public void convertRequestParamFromRawJson_preservesObjectNumericLiterals() throws Exception {
        JSONObject out = (JSONObject) HttpRequestJsonParams.convertRequestParamFromRawJson("{\"n\":1.0,\"s\":\"hello\"}", null);
        assertEquals("1.0", out.getString("n"));
        assertEquals("hello", out.getString("s"));
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
    public void gsonStyleLongFromNumberString_matchesGson214() {
        assertEquals(100L, HttpRequestJsonParams.gsonStyleLongFromNumberString("100"));
        assertEquals(3L, HttpRequestJsonParams.gsonStyleLongFromNumberString("3.14"));
        assertEquals(7766279631452241920L, HttpRequestJsonParams.gsonStyleLongFromNumberString("1e20"));
    }

    @Test
    public void extractJsonArrayAfterKey_throwsWhenKeyMissing() {
        try {
            HttpRequestJsonParams.extractJsonArrayAfterKey("{}", "params");
            assertTrue("expected JSONException", false);
        } catch (JSONException expected) {
            // Missing params key
        }
    }

    @Test
    public void extractJsonArrayAfterKey_throwsOnMalformedObject() {
        try {
            HttpRequestJsonParams.extractJsonArrayAfterKey("{", "params");
            assertTrue("expected JSONException", false);
        } catch (JSONException expected) {
            // Truncated JSON
        }
    }

    @Test
    public void extractJsonArrayAfterKey_ignoresParamsSubstringInsideStringValue() throws Exception {
        String body = "{\"statement\":\"see \\\"params\\\": [99]\",\"params\":[42]}";
        String rawParams = HttpRequestJsonParams.extractJsonArrayAfterKey(body, "params");
        assertEquals("[42]", rawParams);
    }

    @Test
    public void extractJsonArrayAfterKey_usesLastDuplicateKeyLikeJSONObject() throws Exception {
        String body = "{\"params\":[1,2],\"params\":[\"a\"]}";
        String rawParams = HttpRequestJsonParams.extractJsonArrayAfterKey(body, "params");
        assertEquals("[\"a\"]", rawParams);

        JSONArray paramsJson = new JSONObject(body).getJSONArray("params");
        JSArray params = new JSArray();
        HttpRequestJsonParams.populateJsArrayFromParamsJson(paramsJson, params, rawParams);
        assertEquals(1, params.length());
        assertEquals("a", params.get(0));
    }

    @Test
    public void populateJsArrayFromParamsJson_skipsUnsupportedArrayElements() throws Exception {
        JSONArray nested = new JSONArray();
        nested.put(1);
        assertNull(HttpRequestJsonParams.convertRequestParam(nested));

        String rawParams = "[ [1], \"kept\" ]";
        JSONArray input = new JSONArray(rawParams);

        JSArray params = new JSArray();
        HttpRequestJsonParams.populateJsArrayFromParamsJson(input, params, rawParams);
        assertEquals(1, params.length());
        assertEquals("kept", params.get(0));
    }

    @Test
    public void convertRequestParamFromRawJson_rejectsNestedObjectFieldsLikeGson() {
        try {
            HttpRequestJsonParams.convertRequestParamFromRawJson("{\"meta\":{\"a\":1}}", null);
            assertTrue("expected IllegalStateException", false);
        } catch (IllegalStateException expected) {
            // Gson getAsString() on nested objects throws
        }
    }

    @Test
    public void populateJsArrayFromParamsJson_usesRawNumberLiterals() throws Exception {
        String rawParams = "[1e20]";
        JSONArray input = new JSONArray("[100000000000000000000]");

        JSArray params = new JSArray();
        HttpRequestJsonParams.populateJsArrayFromParamsJson(input, params, rawParams);

        assertEquals(1, params.length());
        assertEquals(7766279631452241920L, params.get(0));
    }
}
