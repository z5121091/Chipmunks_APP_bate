package com.chipmunks.ocrlab;

import android.graphics.Bitmap;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.SystemClock;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;

import java.util.ArrayList;
import java.util.List;

/** Invoked on the main thread. ML Kit performs recognition asynchronously. */
final class OcrEngine implements AutoCloseable {
    interface Callback {
        void onSuccess(OcrResult result);
        void onError(Exception error);
    }

    private final TextRecognizer recognizer =
        TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
    private boolean active;
    private boolean closed;

    void recognize(Bitmap image, Callback callback) {
        if (active || closed) throw new IllegalStateException("Recognizer is busy or closed");
        long start = SystemClock.elapsedRealtime();
        InputImage input = InputImage.fromBitmap(image, 0);
        active = true;
        try {
            recognizer.process(input).addOnCompleteListener(task -> {
                active = false;
                if (closed) {
                    recognizer.close();
                    return;
                }
                if (!task.isSuccessful()) {
                    Exception error = task.getException();
                    callback.onError(error != null ? error : new IllegalStateException("Recognition cancelled"));
                    return;
                }
                List<OcrBlock> boxes = new ArrayList<>();
                for (Text.TextBlock block : task.getResult().getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        Rect bounds = line.getBoundingBox();
                        if (bounds == null || line.getText().trim().isEmpty()) continue;
                        RectF clipped = new RectF(bounds);
                        if (clipped.intersect(0, 0, image.getWidth(), image.getHeight())) {
                            boxes.add(new OcrBlock(String.valueOf(boxes.size()), line.getText(), line.getConfidence(), clipped));
                        }
                    }
                }
                callback.onSuccess(new OcrResult(boxes, image.getWidth(), image.getHeight(),
                    SystemClock.elapsedRealtime() - start));
            });
        } catch (RuntimeException error) {
            active = false;
            throw error;
        }
    }

    @Override public void close() {
        if (closed) return;
        closed = true;
        if (!active) recognizer.close();
    }
}
