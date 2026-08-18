package com.monroe.moneyweather;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
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

    @ActivityCallback
    private void pickFolderResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri uri = result.getData().getData();
            if (uri != null) {
                int takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION;
                try {
                    getContext().getContentResolver().takePersistableUriPermission(uri, takeFlags);
                } catch (SecurityException e) {
                    Log.w(TAG, "Could not take persistable permission for folder: " + e.getMessage());
                }

                JSObject jsResult = new JSObject();
                jsResult.put("uri", uri.toString());
                call.resolve(jsResult);
            } else {
                call.reject("No folder selected");
            }
        } else {
            call.reject("User cancelled");
        }
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity is null");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, false);

        startActivityForResult(call, intent, "pickFolderResult");
    }

    // Locate a child document within a picked folder tree by its display name.
    // Returns null if no matching child exists.
    private Uri findChildDocumentUri(Uri treeUri, String fileName) {
        ContentResolver resolver = getContext().getContentResolver();
        String parentDocumentId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId);

        try (Cursor cursor = resolver.query(
                childrenUri,
                new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME},
                null, null, null)) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String displayName = cursor.getString(1);
                    if (fileName.equals(displayName)) {
                        String docId = cursor.getString(0);
                        return DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "findChildDocumentUri failed: " + e.getMessage());
        }
        return null;
    }

    @PluginMethod
    public void getFileInfoInFolder(PluginCall call) {
        String treeUriString = call.getString("treeUri");
        String fileName = call.getString("fileName");
        if (treeUriString == null || treeUriString.isEmpty() || fileName == null || fileName.isEmpty()) {
            call.reject("treeUri and fileName are required");
            return;
        }

        Uri treeUri = Uri.parse(treeUriString);
        JSObject result = new JSObject();
        try {
            Uri docUri = findChildDocumentUri(treeUri, fileName);
            if (docUri == null) {
                result.put("exists", false);
                result.put("name", (String) null);
                result.put("size", -1);
                result.put("modifiedAt", (String) null);
                call.resolve(result);
                return;
            }

            ContentResolver resolver = getContext().getContentResolver();
            long size = -1;
            try (ParcelFileDescriptor pfd = resolver.openFileDescriptor(docUri, "r")) {
                if (pfd != null) {
                    StructStat stat = Os.fstat(pfd.getFileDescriptor());
                    if (stat != null) size = stat.st_size;
                }
            } catch (Exception e) {
                Log.w(TAG, "fstat failed for folder child: " + e.getMessage());
            }

            result.put("exists", true);
            result.put("name", fileName);
            result.put("size", size);
            result.put("modifiedAt", (String) null);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Error reading folder file info: " + e.getMessage(), e);
            call.reject("Error reading file info: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readFileInFolder(PluginCall call) {
        String treeUriString = call.getString("treeUri");
        String fileName = call.getString("fileName");
        if (treeUriString == null || treeUriString.isEmpty() || fileName == null || fileName.isEmpty()) {
            call.reject("treeUri and fileName are required");
            return;
        }

        Uri treeUri = Uri.parse(treeUriString);
        Uri docUri = findChildDocumentUri(treeUri, fileName);
        if (docUri == null) {
            call.reject("File not found in folder: " + fileName);
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        try (ParcelFileDescriptor pfd = resolver.openFileDescriptor(docUri, "r")) {
            if (pfd == null) {
                call.reject("Could not open file descriptor for folder file");
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
            Log.d(TAG, "readFileInFolder fileName=" + fileName + " bytes=" + bytes.length);

            JSObject result = new JSObject();
            result.put("data", base64);
            call.resolve(result);
        } catch (SecurityException e) {
            Log.e(TAG, "Permission denied reading folder file: " + fileName, e);
            call.reject("Permission denied: " + e.getMessage());
        } catch (IOException e) {
            Log.e(TAG, "IO error reading folder file: " + fileName, e);
            call.reject("IO error: " + e.getMessage());
        }
    }

    // Write-new-then-swap strategy: some cloud providers (notably OneDrive's SAF
    // DocumentsProvider) do not correctly overwrite a document in-place when
    // opened with "wt" (truncate) — they can create a separate conflicting copy
    // instead of updating the original. A naive fix of deleting the old document
    // first and then creating a new one is unsafe: if document creation or the
    // write fails after the delete, the backup is permanently lost with no
    // recovery path. Instead we:
    //   1. Create a brand new document under a temporary name and write the full
    //      contents to it (the old document is untouched during this step).
    //   2. Only once the write is confirmed complete do we delete the old document.
    //   3. Rename the temporary document to the target file name.
    // If step 3 fails, the data is still safe on disk under the temporary name
    // (nothing is lost — the caller can find it under fileName + ".tmp-<ts>").
    @PluginMethod
    public void writeFileInFolder(PluginCall call) {
        String treeUriString = call.getString("treeUri");
        String fileName = call.getString("fileName");
        String data = call.getString("data");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (treeUriString == null || treeUriString.isEmpty() || fileName == null || fileName.isEmpty()) {
            call.reject("treeUri and fileName are required");
            return;
        }
        if (data == null) {
            call.reject("data is required");
            return;
        }

        Uri treeUri = Uri.parse(treeUriString);
        ContentResolver resolver = getContext().getContentResolver();
        String tempName = fileName + ".tmp-" + System.currentTimeMillis();

        Uri tempDocUri = null;
        try {
            // Step 1: create a new document under a temporary name and write to it.
            // The existing (old) document is not touched here.
            tempDocUri = DocumentsContract.createDocument(resolver, treeUri, mimeType, tempName);
            if (tempDocUri == null) {
                call.reject("Could not create temporary document in folder");
                return;
            }

            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            try (ParcelFileDescriptor pfd = resolver.openFileDescriptor(tempDocUri, "w")) {
                if (pfd == null) {
                    call.reject("Could not open file descriptor for temporary document");
                    return;
                }
                FileOutputStream out = new FileOutputStream(pfd.getFileDescriptor());
                try {
                    out.getChannel().truncate(0);
                } catch (IOException e) {
                    Log.w(TAG, "writeFileInFolder explicit truncate(0) failed (continuing): " + e.getMessage());
                }
                out.write(bytes);
                out.flush();
                try {
                    out.getFD().sync();
                    Log.d(TAG, "writeFileInFolder wrote temp=" + tempName + " bytes=" + bytes.length + " fdSync=true");
                } catch (java.io.SyncFailedException e) {
                    Log.w(TAG, "writeFileInFolder fd.sync not supported: " + e.getMessage());
                }
                out.close();
            }

            // Step 2: the new content is safely written under the temp name.
            // Only now do we remove the old document, if one exists.
            Uri existing = findChildDocumentUri(treeUri, fileName);
            if (existing != null) {
                try {
                    boolean deleted = DocumentsContract.deleteDocument(resolver, existing);
                    Log.d(TAG, "writeFileInFolder deleted old document: " + deleted);
                } catch (Exception e) {
                    Log.w(TAG, "writeFileInFolder could not delete old document (continuing): " + e.getMessage());
                }
            }

            // Step 3: rename the temp document to the target file name.
            Uri finalUri = tempDocUri;
            try {
                Uri renamed = DocumentsContract.renameDocument(resolver, tempDocUri, fileName);
                if (renamed != null) {
                    finalUri = renamed;
                }
            } catch (Exception e) {
                // Data is NOT lost: it is safely stored under tempName. Surface a
                // clear error instead of reporting false success, so the caller
                // (and user) knows exactly where the data currently lives.
                Log.e(TAG, "writeFileInFolder rename to final name failed: " + e.getMessage(), e);
                call.reject("Backup was saved but could not be renamed to \"" + fileName + "\". " +
                        "Your data is safe under the name \"" + tempName + "\" in the same folder: " + e.getMessage());
                return;
            }

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("bytesWritten", bytes.length);
            result.put("uri", finalUri.toString());
            call.resolve(result);
        } catch (SecurityException e) {
            Log.e(TAG, "Permission denied writing folder file: " + fileName, e);
            call.reject("Permission denied: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "Error writing folder file: " + fileName, e);
            call.reject("Error writing file: " + e.getMessage());
        }
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
            // Explicitly truncate via the file channel before writing. This is a documented
            // Android SAF issue: some providers (notably OneDrive) do not reliably honor the
            // "wt" truncate mode, leaving trailing bytes from a previously larger file, or
            // otherwise mishandling the overwrite. An explicit channel-level truncate(0) is
            // the confirmed workaround and is safe to call even for providers that already
            // truncate correctly.
            try {
                out.getChannel().truncate(0);
            } catch (IOException e) {
                Log.w(TAG, "writeFile explicit truncate(0) failed (continuing): " + e.getMessage());
            }
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
