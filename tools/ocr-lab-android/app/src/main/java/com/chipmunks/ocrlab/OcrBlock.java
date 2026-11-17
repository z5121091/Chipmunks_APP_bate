package com.chipmunks.ocrlab;

import android.graphics.RectF;

final class OcrBlock {
    final String id;
    final String text;
    final float confidence;
    final RectF bounds;

    OcrBlock(String id, String text, float confidence, RectF bounds) {
        this.id = id;
        this.text = text;
        this.confidence = confidence;
        this.bounds = new RectF(bounds);
    }
}
