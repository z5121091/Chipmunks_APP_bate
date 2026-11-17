package com.chipmunks.ocrlab;

import android.content.Context;
import android.util.AtomicFile;

import org.json.JSONException;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

final class TemplateStore {
    private final AtomicFile file;

    TemplateStore(Context context) {
        file = new AtomicFile(new File(context.getFilesDir(), "ocr-template.json"));
    }

    FieldTemplate load() throws IOException, JSONException {
        try {
            byte[] bytes = file.readFully();
            return FieldTemplate.fromJson(new String(bytes, StandardCharsets.UTF_8));
        } catch (FileNotFoundException absent) {
            return null;
        }
    }

    void save(FieldTemplate template) throws IOException, JSONException {
        byte[] data = template.toJson().getBytes(StandardCharsets.UTF_8);
        FileOutputStream stream = file.startWrite();
        try {
            stream.write(data);
            file.finishWrite(stream);
        } catch (IOException | RuntimeException error) {
            file.failWrite(stream);
            throw error;
        }
    }
}
