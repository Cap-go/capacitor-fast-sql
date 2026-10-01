package app.capgo.capacitor.fastsql;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;

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

        int converted = 0;
        for (int i = 0; i < input.length(); i++) {
            if (HttpRequestJsonParams.convertRequestParam(input.get(i)) != null) {
                converted++;
            }
        }
        assertEquals(1, converted);
    }
}
