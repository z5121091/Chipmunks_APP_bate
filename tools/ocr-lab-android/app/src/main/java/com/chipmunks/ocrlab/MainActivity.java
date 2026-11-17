package com.chipmunks.ocrlab;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class MainActivity extends AppCompatActivity {
    private static final int MAX_IMAGE_EDGE = 2048;
    private static final String[] FIELD_KEYS = {
        "inventoryCode", "model", "version", "package", "batch", "quantity", "productionDate", "traceNo", "boxNo"
    };
    private static final String[] FIELD_NAMES = {
        "存货编码", "型号", "版本号", "封装", "批次", "数量", "生产日期", "追溯码", "箱号"
    };
    private static final Pattern PREFIX = Pattern.compile("^([^:：]{1,20})[:：]");
    private static final String[][] KNOWN_PREFIXES = {
        {"存货编码", "ITEM CODE"}, {"型号", "P/N", "PART NO", "MODEL"}, {"版本", "版本号", "REV", "D/C"},
        {"封装", "PKG", "PACKAGE"}, {"批次", "LOT", "LOT NO", "BATCH"}, {"数量", "QTY", "QUANTITY"},
        {"生产日期", "DATE", "MFG DATE"}, {"追溯码", "TRACE NO", "TRACE"}, {"箱号", "BOX NO", "BOX ID"}
    };
    private final ExecutorService imageWorker = Executors.newSingleThreadExecutor();
    private final Set<String> selected = new LinkedHashSet<>();
    private final Map<String, FieldTemplate.Selection> fields = new LinkedHashMap<>();
    private final Map<String, Set<String>> fieldSources = new LinkedHashMap<>();
    private OcrEngine engine;
    private TemplateStore templates;
    private FieldTemplate savedTemplate;
    private Bitmap photo;
    private OcrResult result;
    private String source = "";
    private boolean busy;
    private int sampleNumber;
    private int generation;
    private TextView status, selectionText, mappedText, rawText, templateText;
    private Button takeButton, pickButton, sampleButton, fieldButton, saveButton, applyButton, copyButton, rawButton;
    private LabelImageView image;

    private final ActivityResultLauncher<String[]> imagePicker = registerForActivityResult(
        new ActivityResultContracts.OpenDocument(), uri -> {
            if (uri != null) loadAndRecognize(uri, null, "相册图片");
        });
    private final ActivityResultLauncher<Intent> camera = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), response -> {
            if (response.getResultCode() != Activity.RESULT_OK || response.getData() == null) return;
            String name = response.getData().getStringExtra(CaptureActivity.PHOTO_NAME);
            if (name == null || !name.matches("ocr-capture-[0-9]+\\.jpg")) {
                status.setText("未取得拍摄结果，请重新拍照。");
                return;
            }
            File temporaryPhoto = new File(getCacheDir(), name);
            loadAndRecognize(Uri.fromFile(temporaryPhoto), temporaryPhoto, "相机拍照");
        });

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        templates = new TemplateStore(this);
        buildScreen();
        try {
            savedTemplate = templates.load();
        } catch (Exception error) {
            status.setText("未能读取上次保存的模板，可以重新建立。");
        }
        renderResults();
    }

    private void buildScreen() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(LabUi.PAGE);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int padding = LabUi.dp(this, 14);
        content.setPadding(padding, padding, padding, padding);
        scroll.addView(content);

        TextView title = LabUi.text(this, "标签 OCR 试验", 23);
        title.setTypeface(null, Typeface.BOLD);
        content.addView(title);
        status = LabUi.text(this, "拍照、选图，或用样张试一遍。", 14);
        status.setTextColor(LabUi.MUTED);
        add(content, status, 6);

        takeButton = LabUi.button(this, "拍照", true);
        pickButton = LabUi.button(this, "选图", false);
        sampleButton = LabUi.button(this, "识别样张", false);
        takeButton.setOnClickListener(view -> camera.launch(new Intent(this, CaptureActivity.class)));
        pickButton.setOnClickListener(view -> imagePicker.launch(new String[] {"image/*"}));
        sampleButton.setOnClickListener(view -> recognizeSample());
        add(content, row(takeButton, pickButton, sampleButton), 12);

        image = new LabelImageView(this, this::toggleSelection);
        add(content, image, 12);
        selectionText = LabUi.text(this, "", 14);
        add(content, selectionText, 8);
        fieldButton = LabUi.button(this, "设为字段", false);
        fieldButton.setOnClickListener(view -> chooseField());
        fieldButton.setVisibility(View.GONE);
        add(content, fieldButton, 6);

        templateText = LabUi.text(this, "", 13);
        templateText.setTextColor(LabUi.MUTED);
        add(content, templateText, 12);
        mappedText = LabUi.text(this, "", 15);
        mappedText.setTextIsSelectable(true);
        add(content, mappedText, 6);
        saveButton = LabUi.button(this, "保存模板", false);
        applyButton = LabUi.button(this, "应用模板", false);
        saveButton.setOnClickListener(view -> saveTemplate());
        applyButton.setOnClickListener(view -> applySavedTemplate());
        add(content, row(saveButton, applyButton), 6);

        rawButton = LabUi.button(this, "查看识别原文", false);
        rawButton.setOnClickListener(view -> {
            boolean show = rawText.getVisibility() != View.VISIBLE;
            rawText.setVisibility(show ? View.VISIBLE : View.GONE);
            rawButton.setText(show ? "收起识别原文" : "查看识别原文");
        });
        copyButton = LabUi.button(this, "复制结果", false);
        copyButton.setOnClickListener(view -> copyResult());
        add(content, row(rawButton, copyButton), 12);
        rawText = LabUi.text(this, "", 14);
        rawText.setTextIsSelectable(true);
        rawText.setVisibility(View.GONE);
        add(content, rawText, 8);
        LabUi.setRoot(this, scroll);
    }

    private void add(LinearLayout parent, View view, int topDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = LabUi.dp(this, topDp);
        parent.addView(view, params);
    }

    private LinearLayout row(Button... buttons) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        for (int i = 0; i < buttons.length; i++) {
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1);
            if (i > 0) params.leftMargin = LabUi.dp(this, 6);
            row.addView(buttons[i], params);
        }
        return row;
    }

    private void loadAndRecognize(Uri uri, File temporary, String label) {
        if (busy) return;
        final int job = startImage(label);
        imageWorker.execute(() -> {
            Bitmap decoded = null;
            try {
                decoded = ImageLoader.load(getContentResolver(), uri, MAX_IMAGE_EDGE);
            } catch (Exception | OutOfMemoryError error) {
                // The app keeps one bounded image. Invalid or oversized sources can be retried.
            } finally {
                if (temporary != null) temporary.delete();
            }
            Bitmap loaded = decoded;
            runOnUiThread(() -> {
                if (!isCurrent(job)) return;
                if (loaded == null) {
                    endWithError("无法读取图片，可尝试缩小图片或重新拍照。");
                    return;
                }
                runOcr(job, loaded);
            });
        });
    }

    private int startImage(String label) {
        busy = true;
        photo = null;
        result = null;
        source = label;
        fields.clear();
        fieldSources.clear();
        selected.clear();
        status.setText("正在读取" + label + "…");
        rawText.setVisibility(View.GONE);
        rawButton.setText("查看识别原文");
        renderResults();
        return ++generation;
    }

    private void runOcr(int job, Bitmap bitmap) {
        photo = bitmap;
        status.setText("正在本机识别…");
        renderResults();
        try {
            if (engine == null) engine = new OcrEngine();
            engine.recognize(bitmap, new OcrEngine.Callback() {
                @Override public void onSuccess(OcrResult output) {
                    if (!isCurrent(job)) return;
                    busy = false;
                    result = output;
                    status.setText(output.blocks.isEmpty()
                        ? "没有识别到文字。请拍清楚一点或选其他图片。"
                        : source + " · " + output.blocks.size() + " 段文字 · 识别 " + output.elapsedMs + " ms");
                    renderResults();
                }
                @Override public void onError(Exception error) {
                    if (isCurrent(job)) endWithError("文字识别失败，请换图或重新拍照。");
                }
            });
        } catch (RuntimeException error) {
            endWithError("无法启动本机文字识别，请重开试验应用。");
        }
    }

    private boolean isCurrent(int job) {
        return !isFinishing() && !isDestroyed() && generation == job;
    }

    private void endWithError(String message) {
        busy = false;
        status.setText(message);
        renderResults();
    }

    private void recognizeSample() {
        boolean first = sampleNumber++ % 2 == 0;
        int job = startImage(first ? "样张 A" : "样张 B");
        Bitmap bitmap = Bitmap.createBitmap(1200, 680, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);
        Paint ink = new Paint(Paint.ANTI_ALIAS_FLAG);
        ink.setColor(Color.BLACK);
        ink.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        ink.setTextSize(58);
        String[] lines = first
            ? new String[] {"P/N: MOT3114G", "LOT: ZYA.C", "QTY: 5000 PCS", "DATE: 20261022", "BOX NO: 0005", "封装：PDFN5×6"}
            : new String[] {"P/N: MOT5280G", "LOT: KBC.A", "QTY: 3200 PCS", "DATE: 20261108", "BOX NO: 0009", "封装：SOT-23"};
        for (int i = 0; i < lines.length; i++) canvas.drawText(lines[i], 64, 100 + i * 100, ink);
        runOcr(job, bitmap);
    }

    private void toggleSelection(OcrBlock block) {
        if (!selected.add(block.id)) selected.remove(block.id);
        renderResults();
    }

    private List<OcrBlock> selection() {
        List<OcrBlock> blocks = new ArrayList<>();
        if (result != null) {
            for (OcrBlock block : result.blocks) if (selected.contains(block.id)) blocks.add(block);
        }
        return blocks;
    }

    private void chooseField() {
        List<OcrBlock> blocks = selection();
        if (blocks.isEmpty()) return;
        new AlertDialog.Builder(this).setTitle("所选文字对应哪个字段？")
            .setItems(FIELD_NAMES, (dialog, index) -> {
                try {
                    String field = FIELD_KEYS[index];
                    String prefix = findPrefix(blocks, index);
                    fields.put(field, FieldTemplate.Selection.fromSelection(field, blocks,
                        result.imageWidth, result.imageHeight, prefix));
                    Set<String> sources = new LinkedHashSet<>();
                    for (OcrBlock block : blocks) sources.add(block.id);
                    fieldSources.put(field, sources);
                    selected.clear();
                    renderResults();
                } catch (IllegalArgumentException error) {
                    status.setText("无法使用所选文字范围，请重新选中。");
                }
            }).setNegativeButton("取消", null).show();
    }

    private String findPrefix(List<OcrBlock> blocks, int fieldIndex) {
        if (blocks.size() != 1) return "";
        Matcher matcher = PREFIX.matcher(blocks.get(0).text);
        if (matcher.find()) {
            for (String alias : KNOWN_PREFIXES[fieldIndex]) {
                if (alias.equalsIgnoreCase(matcher.group(1).trim())) return matcher.group();
            }
        }
        return "";
    }

    private FieldTemplate draftTemplate() {
        return new FieldTemplate("当前标签模板", new ArrayList<>(fields.values()));
    }

    private void saveTemplate() {
        try {
            FieldTemplate draft = draftTemplate();
            FieldTemplate.Result current = draft.apply(result.blocks, result.imageWidth, result.imageHeight);
            if (!current.errors.isEmpty()) {
                status.setText("请先重新点选并修正标记的字段。");
                return;
            }
            templates.save(draft);
            savedTemplate = draft;
            status.setText("模板已保存。下次可换一张同版式标签测试。");
        } catch (Exception error) {
            status.setText("模板保存失败，请检查存储空间后重试。");
        }
        renderResults();
    }

    private void applySavedTemplate() {
        if (savedTemplate == null || result == null) return;
        fields.clear();
        fieldSources.clear();
        for (FieldTemplate.Selection field : savedTemplate.selections) fields.put(field.field, field);
        selected.clear();
        status.setText("已应用上次模板，请对照原图核对字段。");
        renderResults();
    }

    private String mappedResults() {
        if (result == null || fields.isEmpty()) return "";
        FieldTemplate.Result extracted = draftTemplate().apply(result.blocks, result.imageWidth, result.imageHeight);
        List<String> lines = new ArrayList<>();
        for (int i = 0; i < FIELD_KEYS.length; i++) {
            String field = FIELD_KEYS[i];
            if (extracted.errors.containsKey(field)) {
                lines.add(FIELD_NAMES[i] + "：待核对（" + extracted.errors.get(field) + "）");
            } else if (extracted.values.containsKey(field)) {
                lines.add(FIELD_NAMES[i] + "：" + extracted.values.get(field));
            }
        }
        return TextUtils.join("\n", lines);
    }

    private String rawResults() {
        if (result == null) return "";
        List<String> lines = new ArrayList<>();
        for (OcrBlock block : result.blocks) lines.add(block.text);
        return TextUtils.join("\n", lines);
    }

    private void copyResult() {
        if (result == null) return;
        String mapped = mappedResults();
        String text = source + " · " + result.imageWidth + "×" + result.imageHeight + " · 识别 " + result.elapsedMs + " ms\n"
            + (mapped.isEmpty() ? "" : "\n字段候选\n" + mapped + "\n") + "\n识别原文\n" + rawResults();
        ClipboardManager clipboard = getSystemService(ClipboardManager.class);
        if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText("标签 OCR 结果", text));
            status.setText("识别结果已复制。");
        }
    }

    private void renderResults() {
        List<OcrBlock> blocks = result == null ? Collections.emptyList() : result.blocks;
        image.setVisibility(photo == null ? View.GONE : View.VISIBLE);
        Set<String> assigned = new LinkedHashSet<>();
        for (Set<String> sources : fieldSources.values()) assigned.addAll(sources);
        image.display(photo, blocks, selected, assigned);
        List<OcrBlock> picked = selection();
        List<String> lines = new ArrayList<>();
        for (OcrBlock block : picked) lines.add(block.text);
        selectionText.setText(picked.isEmpty() ? "轻点照片上的文字，可选一处或多处，再指定字段。" : TextUtils.join(" / ", lines));
        selectionText.setVisibility(blocks.isEmpty() ? View.GONE : View.VISIBLE);
        fieldButton.setVisibility(picked.isEmpty() ? View.GONE : View.VISIBLE);
        rawText.setText(rawResults());
        String mapped = mappedResults();
        mappedText.setText(mapped);
        mappedText.setVisibility(mapped.isEmpty() ? View.GONE : View.VISIBLE);
        templateText.setText(savedTemplate == null ? "选好字段后可保存一个模板。" : "已保存一个模板，适用于同版式且构图相近的标签。");
        templateText.setVisibility(blocks.isEmpty() ? View.GONE : View.VISIBLE);
        saveButton.setVisibility(blocks.isEmpty() ? View.GONE : View.VISIBLE);
        applyButton.setVisibility(blocks.isEmpty() ? View.GONE : View.VISIBLE);
        saveButton.setEnabled(!fields.isEmpty() && !busy);
        applyButton.setEnabled(savedTemplate != null && !busy);
        rawButton.setVisibility(blocks.isEmpty() ? View.GONE : View.VISIBLE);
        copyButton.setVisibility(blocks.isEmpty() ? View.GONE : View.VISIBLE);
        takeButton.setEnabled(!busy);
        pickButton.setEnabled(!busy);
        sampleButton.setEnabled(!busy);
    }

    @Override public void onConfigurationChanged(Configuration newConfiguration) {
        super.onConfigurationChanged(newConfiguration);
        image.requestLayout();
    }

    @Override protected void onDestroy() {
        generation++;
        if (engine != null) engine.close();
        imageWorker.shutdown();
        super.onDestroy();
    }
}
