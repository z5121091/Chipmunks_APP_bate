package com.chipmunks.ocrlab;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class OcrResult {
    final List<OcrBlock> blocks;
    final int imageWidth;
    final int imageHeight;
    final long elapsedMs;

    OcrResult(List<OcrBlock> blocks, int imageWidth, int imageHeight, long elapsedMs) {
        this.blocks = Collections.unmodifiableList(new ArrayList<>(blocks));
        this.imageWidth = imageWidth;
        this.imageHeight = imageHeight;
        this.elapsedMs = elapsedMs;
    }
}
