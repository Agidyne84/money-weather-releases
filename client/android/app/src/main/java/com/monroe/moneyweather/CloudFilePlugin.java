package com.monroe.moneyweather;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.system.Os;
import android.system.StructStat;
import android.util.Base64;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

@CapacitorPlugin(name = "CloudFile")
public class CloudFilePlugin extends Plugin {
    private static final String TAG = "CloudFile";

    @ActivityCallback
    private void pickFileResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri uri = result.getData().getData();
            if (uri != null) {
                int takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                try {
                    getContext().getContentResolver().takePersistableUriPermission(uri, takeFlags);
                } catch (SecurityException e) {
                    Log.w(TAG, "Could not take persistable permission: " + e.getMessage());
                }

                JSObject jsResult = new JSObject();
                jsResult.put("uri", uri.toString());
                jsResult.put("name", getFileName(uri));
                call.resolve(jsResult);
            } else {
                call.reject("No file selected");
            }
        } else {
            call.reject("User cancelled");
        }
    }

    @PluginMethod
    public void pickFile(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity is null");
            return;
        }

        String mimeType = call.getString("mimeType", "*/*");

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, false);

        startActivityForResult(call, intent, "pickFileResult");
    }

    @PluginMethod
    public void getFileInfo(PluginCall call) {
        String uriString = call.getString("uri");
        if (uriString == null || uriString.isEmpty()) {
            call.reject("uri is required");
            return;
        }

        Uri uri = Uri.parse(uriString);
        ContentResolver resolver = getContext().getContentResolver();

        JSObject result = new JSObject();
        try {
            // Prefer fstat via a file descriptor; it is less likely to return stale cached data
            // than ContentResolver.query() for cloud-backed documents.
            long size = -1;
            try (ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, "r")) {
                if (pfd != null) {
                    FileDescriptor fd = pfd.getFileDescriptor();
                    StructStat stat = Os.fstat(fd);
                    if (stat != null) {
                        size = stat.st_size;
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "fstat failed, falling back to query: " + e.getMessage());
            }

            String name = null;
            try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIndex >= 0) {
                        name = cursor.getString(nameIndex);
                    }
                    // If fstat failed above, try to get size from the cursor as a fallback.
                    if (size < 0) {
                        int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                        if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                            size = cursor.getLong(sizeIndex);
                        }
                    }
                }
            }

            result.put("exists", size >= 0 || name != null);
            result.put("name", name);
            result.put("size", size);
            // ContentResolver does not expose reliable modification time for cloud URIs.
            result.put("modifiedAt", (String) null);
            call.resolve(result);
        } catch (SecurityException e) {
            Log.e(TAG, "Permission denied reading URI info: " + uriString, e);
            result.put("exists", false);
            result.put("size", -1);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Error reading file info: " + e.getMessage(), e);
            call.reject("Error reading file info: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String uriString = call.getString("uri");
        if (uriString == null || uriString.isEmpty()) {
            call.reject("uri is required");
            return;
        }

        Uri uri = Uri.parse(uriString);
        ContentResolver resolver = getContext().getContentResolver();

        // Use a file descriptor instead of openInputStream to reduce the chance of
        // reading stale cached data from cloud-backed providers.
        try (ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, "r")) {
            if (pfd == null) {
                call.reject("Could not open file descriptor for URI");
                return;
            }

            FileInputStream in = new FileInputStream(pfd.getFileDescriptor());
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] tmp = new byte[8192];
            int read;
            while ((read = in.read(tmp)) != -1) {
                buffer.write(tmp, 0, read);
            }
            in.close();

            byte[] bytes = buffer.toByteArray();
            String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);

            Log.d(TAG, "readFile uri=" + uriString + " bytes=" + bytes.length + " base64len=" + base64.length());

            JSObject result = new JSObject();
            result.put("data", base64);
            call.resolve(result);
        } catch (SecurityException e) {
            Log.e(TAG, "Permission denied reading URI: " + uriString, e);
            call.reject("Permission denied: " + e.getMessage());
        } catch (IOException e) {
            Log.e(TAG, "IO error reading URI: " + uriString, e);
            call.reject("IO error: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String uriString = call.getString("uri");
        String data = call.getString("data");
        if (uriString == null || uriString.isEmpty()) {
            call.reject("uri is required");
            return;
        }
        if (data == null) {
            call.reject("data is required");
            return;
        }

        Uri uri = Uri.parse(uriString);
        ContentResolver resolver = getContext().getContentResolver();

        // Use "wt" (write + truncate) so the file is fully replaced, avoiding leftover
        // bytes from a previously larger file. Use NO_WRAP base64 consistently with readFile.
        try (ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, "wt")) {
            if (pfd == null) {
                call.reject("Could not open file descriptor for URI");
                return;
            }

            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            FileOutputStream out = new FileOutputStream(pfd.getFileDescriptor());
            out.write(bytes);
            out.flush();
            // Force the kernel to flush the bytes to the underlying storage before closing.
            // Without this, cloud-backed providers can report a successful write while still
            // holding the new data in a local cache that is never uploaded.
            try {
                out.getFD().sync();
                Log.d(TAG, "writeFile uri=" + uriString + " bytes=" + bytes.length + " fdSync=true");
            } catch (java.io.SyncFailedException e) {
                Log.w(TAG, "writeFile fd.sync not supported by provider: " + e.getMessage());
            }
            out.close();

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("bytesWritten", bytes.length);
            call.resolve(result);
        } catch (SecurityException e) {
            Log.e(TAG, "Permission denied writing URI: " + uriString, e);
            call.reject("Permission denied: " + e.getMessage());
        } catch (IOException e) {
            Log.e(TAG, "IO error writing URI: " + uriString, e);
            call.reject("IO error: " + e.getMessage());
        }
    }

    private String getFileName(Uri uri) {
        String result = null;
        if (uri.getScheme().equals("content")) {
            try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) {
                        result = cursor.getString(idx);
                    }
                }
            }
        }
        if (result == null) {
            result = uri.getLastPathSegment();
        }
        return result;
    }
}
