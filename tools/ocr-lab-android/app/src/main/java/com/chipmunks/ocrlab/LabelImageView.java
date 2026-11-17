package com.chipmunks.ocrlab;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;

import java.util.Collections;
import java.util.List;
import java.util.Set;

final class LabelImageView extends View {
    interface SelectionListener { void onSelect(OcrBlock block); }

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final RectF imageFrame = new RectF();
    private final SelectionListener listener;
    private Bitmap bitmap;
    private List<OcrBlock> blocks = Collections.emptyList();
    private Set<String> selected = Collections.emptySet();
    private Set<String> assigned = Collections.emptySet();
    private OcrBlock tapped;

    LabelImageView(Context context, SelectionListener listener) {
        super(context);
        this.listener = listener;
        setBackground(LabUi.background(context, 0xFFDFE8F1, LabUi.BORDER));
        setContentDescription("标签照片。轻点照片上的文字以选中或取消。");
    }

    void display(Bitmap image, List<OcrBlock> result, Set<String> selection, Set<String> assignedFields) {
        boolean imageChanged = bitmap != image;
        bitmap = image;
        blocks = result;
        selected = selection;
        assigned = assignedFields;
        if (imageChanged) requestLayout();
        invalidate();
    }

    @Override protected void onMeasure(int widthSpec, int heightSpec) {
        int width = MeasureSpec.getSize(widthSpec);
        int availableHeight = Math.round(getResources().getDisplayMetrics().heightPixels * 0.44f);
        int desiredHeight = bitmap == null ? LabUi.dp(getContext(), 100) :
            Math.round((float) width * bitmap.getHeight() / bitmap.getWidth());
        setMeasuredDimension(width, Math.min(desiredHeight, Math.max(LabUi.dp(getContext(), 120), availableHeight)));
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (bitmap == null) return;
        float scale = Math.min((float) getWidth() / bitmap.getWidth(), (float) getHeight() / bitmap.getHeight());
        float left = (getWidth() - bitmap.getWidth() * scale) / 2;
        float top = (getHeight() - bitmap.getHeight() * scale) / 2;
        imageFrame.set(left, top, left + bitmap.getWidth() * scale, top + bitmap.getHeight() * scale);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(0xFFFFFFFF);
        canvas.drawBitmap(bitmap, null, imageFrame, paint);
        if (selected.isEmpty() && assigned.isEmpty()) return;

        canvas.save();
        canvas.translate(left, top);
        canvas.scale(scale, scale);
        canvas.clipRect(0, 0, bitmap.getWidth(), bitmap.getHeight());
        for (OcrBlock block : blocks) {
            boolean active = selected.contains(block.id);
            if (!active && !assigned.contains(block.id)) continue;
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(active ? 0x664979EE : 0x334979EE);
            canvas.drawRect(block.bounds, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth((active ? 2.5f : 1.3f) / scale);
            paint.setColor(active ? 0xFF164ABA : 0xFF3673C4);
            canvas.drawRect(block.bounds, paint);
        }
        canvas.restore();
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (bitmap == null) return false;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                tapped = hit(event.getX(), event.getY());
                return tapped != null;
            case MotionEvent.ACTION_UP:
                OcrBlock hit = hit(event.getX(), event.getY());
                if (hit != null && hit == tapped) performClick();
                tapped = null;
                return true;
            case MotionEvent.ACTION_CANCEL:
                tapped = null;
                return true;
            default:
                return true;
        }
    }

    @Override public boolean performClick() {
        super.performClick();
        if (tapped != null) listener.onSelect(tapped);
        return true;
    }

    private OcrBlock hit(float x, float y) {
        if (!imageFrame.contains(x, y)) return null;
        float originalX = (x - imageFrame.left) * bitmap.getWidth() / imageFrame.width();
        float originalY = (y - imageFrame.top) * bitmap.getHeight() / imageFrame.height();
        OcrBlock match = null;
        float smallestArea = Float.MAX_VALUE;
        for (OcrBlock block : blocks) {
            float area = block.bounds.width() * block.bounds.height();
            if (area < smallestArea && block.bounds.contains(originalX, originalY)) {
                match = block;
                smallestArea = area;
            }
        }
        return match;
    }
}
