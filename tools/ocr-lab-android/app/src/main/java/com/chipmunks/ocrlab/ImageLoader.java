package com.chipmunks.ocrlab;

import android.content.ContentResolver;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.RequiresApi;
import androidx.exifinterface.media.ExifInterface;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;

final class ImageLoader {
    private ImageLoader() {}

    static Bitmap load(ContentResolver resolver, Uri uri, int maxEdge) throws IOException {
        if (Build.VERSION.SDK_INT >= 28) return loadModern(resolver, uri, maxEdge);
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream stream = open(resolver, uri)) {
            BitmapFactory.decodeStream(stream, null, bounds);
        }
        int edge = Math.max(bounds.outWidth, bounds.outHeight);
        if (edge < 1) throw new IOException("Unsupported image");
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (edge / options.inSampleSize > 2 * maxEdge) options.inSampleSize *= 2;
        Bitmap decoded;
        try (InputStream stream = open(resolver, uri)) {
            decoded = BitmapFactory.decodeStream(stream, null, options);
        }
        if (decoded == null) throw new IOException("Unreadable image");
        int rotation = 0;
        boolean mirrored = false;
        try (InputStream stream = open(resolver, uri)) {
            ExifInterface exif = new ExifInterface(stream);
            rotation = exif.getRotationDegrees();
            mirrored = exif.isFlipped();
        } catch (IOException ignored) { /* Formats without EXIF can still be recognized. */ }
        float scale = Math.min(1f, (float) maxEdge / Math.max(decoded.getWidth(), decoded.getHeight()));
        if (rotation == 0 && !mirrored && scale == 1f) return decoded;
        Matrix transform = new Matrix();
        transform.setScale(mirrored ? -scale : scale, scale);
        transform.postRotate(rotation);
        Bitmap result = Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), transform, true);
        if (result != decoded) decoded.recycle();
        return result;
    }

    @RequiresApi(28)
    private static Bitmap loadModern(ContentResolver resolver, Uri uri, int maxEdge) throws IOException {
        ImageDecoder.Source source = "file".equals(uri.getScheme())
            ? ImageDecoder.createSource(new File(uri.getPath())) : ImageDecoder.createSource(resolver, uri);
        return ImageDecoder.decodeBitmap(source, (decoder, info, origin) -> {
            int width = info.getSize().getWidth();
            int height = info.getSize().getHeight();
            float scale = Math.min(1f, (float) maxEdge / Math.max(width, height));
            decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
            decoder.setTargetSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
        });
    }

    private static InputStream open(ContentResolver resolver, Uri uri) throws IOException {
        InputStream stream = resolver.openInputStream(uri);
        if (stream == null) throw new IOException("Image source unavailable");
        return stream;
    }
}
