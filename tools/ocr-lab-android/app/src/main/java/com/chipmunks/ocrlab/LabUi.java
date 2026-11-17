package com.chipmunks.ocrlab;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.appcompat.app.AppCompatActivity;

final class LabUi {
    static final int PAGE = Color.rgb(238, 243, 248);
    static final int NAVY = Color.rgb(25, 59, 96);
    static final int INK = Color.rgb(16, 35, 59);
    static final int MUTED = Color.rgb(72, 91, 112);
    static final int BORDER = Color.rgb(205, 217, 230);

    private LabUi() {}

    static int dp(Context context, int number) {
        return Math.round(number * context.getResources().getDisplayMetrics().density);
    }

    static TextView text(Context context, String value, int size) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(INK);
        return view;
    }

    static GradientDrawable background(Context context, int color, int stroke) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(context, 10));
        if (stroke != Color.TRANSPARENT) shape.setStroke(dp(context, 1), stroke);
        return shape;
    }

    static Button button(Context context, String label, boolean primary) {
        Button view = new Button(context);
        view.setText(label);
        view.setTextSize(14);
        view.setAllCaps(false);
        view.setTextColor(new ColorStateList(
            new int[][] { new int[] { -android.R.attr.state_enabled }, new int[] {} },
            new int[] { primary ? BORDER : MUTED, primary ? Color.WHITE : INK }));
        view.setMinHeight(dp(context, 48));
        view.setMinimumWidth(0);
        view.setPadding(dp(context, 8), dp(context, 8), dp(context, 8), dp(context, 8));
        view.setBackground(new RippleDrawable(ColorStateList.valueOf(0x254C83BA),
            background(context, primary ? NAVY : Color.WHITE, primary ? Color.TRANSPARENT : BORDER), null));
        return view;
    }

    static void setRoot(AppCompatActivity activity, View root) {
        int left = root.getPaddingLeft(), top = root.getPaddingTop();
        int right = root.getPaddingRight(), bottom = root.getPaddingBottom();
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets safe = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(left + safe.left, top + safe.top, right + safe.right, bottom + safe.bottom);
            return windowInsets;
        });
        activity.setContentView(root);
        if (root.isAttachedToWindow()) {
            applySystemBars(activity, root);
        } else {
            // Some Android 13 builds have no window controller during onCreate.
            root.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
                @Override public void onViewAttachedToWindow(View view) {
                    view.removeOnAttachStateChangeListener(this);
                    applySystemBars(activity, view);
                }

                @Override public void onViewDetachedFromWindow(View view) {}
            });
        }
    }

    private static void applySystemBars(AppCompatActivity activity, View root) {
        WindowCompat.setDecorFitsSystemWindows(activity.getWindow(), false);
        WindowInsetsControllerCompat bars = ViewCompat.getWindowInsetsController(root);
        if (bars != null) {
            bars.setAppearanceLightStatusBars(true);
            bars.setAppearanceLightNavigationBars(true);
        }
        ViewCompat.requestApplyInsets(root);
    }
}
