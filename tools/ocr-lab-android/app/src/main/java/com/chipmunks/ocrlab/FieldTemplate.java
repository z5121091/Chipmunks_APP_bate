package com.chipmunks.ocrlab;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class FieldTemplate {
    private static final List<String> TYPES = Arrays.asList(
        "inventoryCode", "model", "version", "package", "batch", "quantity", "productionDate", "traceNo", "boxNo");
    private static final Pattern QUANTITY = Pattern.compile(
        "^([0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)\\s*(?:PCS?|个|件)?$", Pattern.CASE_INSENSITIVE);

    final String name;
    final List<Selection> selections;

    FieldTemplate(String name, List<Selection> selections) {
        this.name = name;
        this.selections = Collections.unmodifiableList(new ArrayList<>(selections));
    }

    static final class Selection {
        final String field;
        final String prefix;
        final List<Region> regions;

        private Selection(String field, String prefix, List<Region> regions) {
            if (!TYPES.contains(field) || regions.isEmpty() || regions.size() > 12 || prefix.length() > 40) {
                throw new IllegalArgumentException("Invalid selection");
            }
            this.field = field;
            this.prefix = normalize(prefix);
            this.regions = Collections.unmodifiableList(new ArrayList<>(regions));
        }

        static Selection fromSelection(String field, List<OcrBlock> boxes, int width, int height, String prefix) {
            List<OcrBlock> ordered = new ArrayList<>(boxes);
            Collections.sort(ordered, (first, second) -> {
                int vertical = Float.compare(first.bounds.top, second.bounds.top);
                return vertical == 0 ? Float.compare(first.bounds.left, second.bounds.left) : vertical;
            });
            List<Region> regions = new ArrayList<>();
            for (OcrBlock box : ordered) {
                regions.add(new Region(box.bounds.left / width, box.bounds.centerY() / height));
            }
            return new Selection(field, prefix, regions);
        }
    }

    private static final class Region {
        final double left, centerY;

        Region(double left, double centerY) {
            if (!(left >= 0 && left <= 1 && centerY >= 0 && centerY <= 1)) {
                throw new IllegalArgumentException("Invalid region");
            }
            this.left = left;
            this.centerY = centerY;
        }
    }

    static final class Result {
        final Map<String, String> values = new LinkedHashMap<>();
        final Map<String, String> errors = new LinkedHashMap<>();
    }

    Result apply(List<OcrBlock> blocks, int width, int height) {
        Result result = new Result();
        if (width <= 0 || height <= 0) return result;
        for (Selection selection : selections) {
            Set<String> used = new HashSet<>();
            List<String> pieces = new ArrayList<>();
            for (int i = 0; i < selection.regions.size(); i++) {
                String prefix = i == 0 ? selection.prefix : "";
                OcrBlock box = findBox(blocks, selection.regions.get(i), width, height, used, prefix);
                if (box == null) break;
                used.add(box.id);
                String value = prefix.isEmpty() ? box.text.trim() : removePrefix(box.text, prefix);
                if (value.isEmpty()) break;
                pieces.add(value);
            }
            if (pieces.size() != selection.regions.size()) {
                result.errors.put(selection.field, "未找到对应文字或位置不明确");
                continue;
            }
            StringBuilder combined = new StringBuilder();
            for (String piece : pieces) {
                if (combined.length() > 0) combined.append(' ');
                combined.append(piece);
            }
            String value = combined.toString();
            if (selection.field.equals("quantity")) {
                value = parseQuantity(value);
                if (value == null) {
                    result.errors.put(selection.field, "数量应为正整数");
                    continue;
                }
            }
            result.values.put(selection.field, value);
        }
        return result;
    }

    private OcrBlock findBox(List<OcrBlock> blocks, Region region, int width, int height, Set<String> used, String prefix) {
        OcrBlock best = null;
        double bestDistance = Double.POSITIVE_INFINITY;
        double nextDistance = Double.POSITIVE_INFINITY;
        for (OcrBlock box : blocks) {
            if (used.contains(box.id) || !hasPrefix(box.text, prefix)) continue;
            double dx = Math.abs(box.bounds.left / width - region.left);
            double dy = Math.abs(box.bounds.centerY() / height - region.centerY);
            if (dx > 0.10 || dy > 0.05) continue;
            double distance = dx + 2 * dy;
            if (distance < bestDistance) {
                nextDistance = bestDistance;
                bestDistance = distance;
                best = box;
            } else if (distance < nextDistance) {
                nextDistance = distance;
            }
        }
        return nextDistance - bestDistance < 0.015 ? null : best;
    }

    private static String normalize(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFKC).trim();
    }

    private static boolean hasPrefix(String text, String prefix) {
        return normalize(text).toUpperCase(Locale.ROOT).startsWith(prefix.toUpperCase(Locale.ROOT));
    }

    private static String removePrefix(String text, String prefix) {
        // Keep the recognized field characters verbatim. Normalize only for matching.
        int colon = text.indexOf(':');
        int fullWidthColon = text.indexOf('：');
        if (colon < 0 || (fullWidthColon >= 0 && fullWidthColon < colon)) colon = fullWidthColon;
        if (colon >= 0 && hasPrefix(text.substring(0, colon + 1), prefix)) {
            return text.substring(colon + 1).trim();
        }
        return "";
    }

    static String parseQuantity(String text) {
        Matcher match = QUANTITY.matcher(normalize(text));
        if (!match.matches()) return null;
        try {
            long value = Long.parseLong(match.group(1).replace(",", ""));
            return value > 0 ? Long.toString(value) : null;
        } catch (NumberFormatException invalid) {
            return null;
        }
    }

    String toJson() throws JSONException {
        JSONArray fields = new JSONArray();
        for (Selection selection : selections) {
            JSONArray regions = new JSONArray();
            for (Region region : selection.regions) {
                regions.put(new JSONArray().put(region.left).put(region.centerY));
            }
            fields.put(new JSONObject().put("field", selection.field).put("prefix", selection.prefix).put("regions", regions));
        }
        return new JSONObject().put("schema", 1).put("name", name).put("fields", fields).toString();
    }

    static FieldTemplate fromJson(String json) throws JSONException {
        JSONObject object = new JSONObject(json);
        JSONArray fields = object.getJSONArray("fields");
        if (object.getInt("schema") != 1 || fields.length() > TYPES.size()) throw new JSONException("Unsupported template");
        List<Selection> selections = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < fields.length(); i++) {
            JSONObject field = fields.getJSONObject(i);
            String type = field.getString("field");
            if (!seen.add(type)) throw new JSONException("Duplicate field");
            JSONArray serialized = field.getJSONArray("regions");
            List<Region> regions = new ArrayList<>();
            for (int j = 0; j < serialized.length(); j++) {
                JSONArray coordinates = serialized.getJSONArray(j);
                regions.add(new Region(coordinates.getDouble(0), coordinates.getDouble(1)));
            }
            selections.add(new Selection(type, field.optString("prefix"), regions));
        }
        return new FieldTemplate(object.getString("name"), selections);
    }
}
