package com.chipmunks.ocrlab;

import org.json.JSONException;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;

public final class FieldTemplateTest {
    @Test public void quantitiesPreserveTheValueAndRejectMisreadCharacters() {
        assertEquals("5000", FieldTemplate.parseQuantity("５，０００ PCS"));
        assertEquals("3200", FieldTemplate.parseQuantity("3200件"));
        for (String bad : new String[] { "5OOO PCS", "MOT3114G", "5,00", "2.5", "0", "-20", "9223372036854775808" }) {
            assertNull(bad, FieldTemplate.parseQuantity(bad));
        }
    }

    @Test public void templateRoundTripStoresLocationAndPrefixWithoutTheSampleValue() throws Exception {
        String serialized = "{\"schema\":1,\"name\":\"标签\",\"fields\":["
            + "{\"field\":\"model\",\"prefix\":\"P/N：\",\"regions\":[[0.2,0.3]],\"sample\":\"MOT3114G\"}]}";
        FieldTemplate template = FieldTemplate.fromJson(serialized);
        assertEquals("model", template.selections.get(0).field);
        assertEquals("P/N:", template.selections.get(0).prefix);
        assertEquals("标签", FieldTemplate.fromJson(template.toJson()).name);
        assertFalse(template.toJson().contains("MOT3114G"));
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsCoordinatesOutsideTheImage() throws JSONException {
        FieldTemplate.fromJson("{\"schema\":1,\"name\":\"标签\",\"fields\":["
            + "{\"field\":\"batch\",\"regions\":[[-0.2,0.3]]}]}");
    }

    @Test(expected = JSONException.class)
    public void rejectsDuplicateFields() throws JSONException {
        FieldTemplate.fromJson("{\"schema\":1,\"name\":\"标签\",\"fields\":["
            + "{\"field\":\"model\",\"regions\":[[0.1,0.2]]},{\"field\":\"model\",\"regions\":[[0.4,0.7]]}]}");
    }
}
