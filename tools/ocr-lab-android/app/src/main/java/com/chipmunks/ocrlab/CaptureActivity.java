package com.chipmunks.ocrlab;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.MotionEvent;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

public final class CaptureActivity extends AppCompatActivity {
    static final String PHOTO_NAME = "captureName";
    private PreviewView preview;
    private TextView hint;
    private Button shutter;
    private ImageCapture capture;
    private Camera camera;
    private boolean capturing;

    private final ActivityResultLauncher<String> permission = registerForActivityResult(
        new ActivityResultContracts.RequestPermission(), granted -> {
            if (granted) startPreview();
            else hint.setText("相机权限未开启。返回后可以从相册选图。");
        });

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(LabUi.dp(this, 12), LabUi.dp(this, 8), LabUi.dp(this, 12), LabUi.dp(this, 8));
        layout.setBackgroundColor(LabUi.PAGE);
        Button back = LabUi.button(this, "返回", false);
        back.setOnClickListener(view -> finish());
        layout.addView(back);
        hint = LabUi.text(this, "将一张标签放在画面中，点击文字处对焦。", 15);
        hint.setPadding(0, LabUi.dp(this, 8), 0, LabUi.dp(this, 8));
        layout.addView(hint);
        preview = new PreviewView(this);
        preview.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        preview.setScaleType(PreviewView.ScaleType.FIT_CENTER);
        preview.setBackgroundColor(Color.BLACK);
        preview.setContentDescription("标签相机预览，轻点对焦");
        preview.setOnTouchListener((view, event) -> {
            if (event.getAction() == MotionEvent.ACTION_UP && camera != null && !capturing) {
                view.performClick();
                try {
                    camera.getCameraControl().startFocusAndMetering(new FocusMeteringAction.Builder(
                        preview.getMeteringPointFactory().createPoint(event.getX(), event.getY()))
                        .setAutoCancelDuration(3, TimeUnit.SECONDS).build());
                } catch (IllegalArgumentException ignored) { /* Unsupported focus region. */ }
            }
            return true;
        });
        layout.addView(preview, new LinearLayout.LayoutParams(-1, 0, 1f));
        shutter = LabUi.button(this, "拍照", true);
        shutter.setGravity(Gravity.CENTER);
        shutter.setEnabled(false);
        shutter.setOnClickListener(view -> takePhoto());
        layout.addView(shutter);
        LabUi.setRoot(this, layout);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startPreview();
        } else if (state == null) {
            permission.launch(Manifest.permission.CAMERA);
        }
    }

    private void startPreview() {
        com.google.common.util.concurrent.ListenableFuture<ProcessCameraProvider> future =
            ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            if (isFinishing() || isDestroyed()) return;
            try {
                ProcessCameraProvider provider = future.get();
                Preview stream = new Preview.Builder().build();
                stream.setSurfaceProvider(preview.getSurfaceProvider());
                capture = new ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build();
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, stream, capture);
                shutter.setEnabled(true);
            } catch (Exception error) {
                hint.setText("暂时无法打开后置相机。返回后可以从相册选图。");
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void takePhoto() {
        if (capture == null || capturing) return;
        File photo;
        try {
            photo = File.createTempFile("ocr-capture-", ".jpg", getCacheDir());
        } catch (IOException error) {
            hint.setText("无法保存临时照片，请检查存储空间。");
            return;
        }
        capturing = true;
        shutter.setEnabled(false);
        hint.setText("正在拍照…");
        if (preview.getDisplay() != null) capture.setTargetRotation(preview.getDisplay().getRotation());
        Executor main = ContextCompat.getMainExecutor(this);
        capture.takePicture(new ImageCapture.OutputFileOptions.Builder(photo).build(), main,
            new ImageCapture.OnImageSavedCallback() {
                @Override public void onImageSaved(@NonNull ImageCapture.OutputFileResults result) {
                    if (isFinishing() || isDestroyed()) {
                        photo.delete();
                        return;
                    }
                    setResult(RESULT_OK, new Intent().putExtra(PHOTO_NAME, photo.getName()));
                    finish();
                }
                @Override public void onError(@NonNull ImageCaptureException error) {
                    photo.delete();
                    if (isFinishing() || isDestroyed()) return;
                    capturing = false;
                    shutter.setEnabled(true);
                    hint.setText("拍照失败，请对焦后重试。");
                }
            });
    }
}
