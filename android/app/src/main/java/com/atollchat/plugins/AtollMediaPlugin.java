package com.atollchat.plugins;

import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.Transformer;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.UUID;

@CapacitorPlugin(name = "AtollMediaPlugin")
public class AtollMediaPlugin extends Plugin {

    @PluginMethod
    public void compressVideo(PluginCall call) {
        String sourcePath = call.getString("sourcePath");
        if (sourcePath == null) {
            call.reject("sourcePath is required");
            return;
        }

        // Clean file:// prefix if present
        if (sourcePath.startsWith("file://")) {
            sourcePath = sourcePath.substring(7);
        }

        Context context = getContext();
        File sourceFile = new File(sourcePath);
        if (!sourceFile.exists()) {
            call.reject("Source file does not exist: " + sourcePath);
            return;
        }

        try {
            File cacheDir = context.getCacheDir();
            String uniqueName = "compressed-" + UUID.randomUUID().toString() + ".mp4";
            File destinationFile = new File(cacheDir, uniqueName);
            String destinationPath = destinationFile.getAbsolutePath();

            // Run AndroidX Media3 Transformer on the UI thread to ensure a Looper is present
            getActivity().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        // Set up AndroidX Media3 Transformer for hardware-accelerated transcoding
                        Transformer transformer = new Transformer.Builder(context)
                                .setVideoMimeType(MimeTypes.VIDEO_H264)
                                .build();

                        MediaItem mediaItem = MediaItem.fromUri(Uri.fromFile(sourceFile));
                        EditedMediaItem editedMediaItem = new EditedMediaItem.Builder(mediaItem).build();

                        // Run transformer asynchronously
                        transformer.addListener(new Transformer.Listener() {
                            @Override
                            public void onCompleted(Composition composition, ExportResult exportResult) {
                                JSObject ret = new JSObject();
                                ret.put("destinationPath", destinationPath);
                                call.resolve(ret);
                            }

                            @Override
                            public void onError(Composition composition, ExportResult exportResult, ExportException exportException) {
                                call.reject("Video compression failed: " + exportException.getMessage(), exportException);
                            }
                        });

                        // Start export
                        transformer.start(editedMediaItem, destinationPath);

                    } catch (Exception e) {
                        call.reject("Failed to execute video compression on UI thread: " + e.getMessage(), e);
                    }
                }
            });

        } catch (Exception e) {
            call.reject("Failed to initiate video compression: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void extractThumbnail(PluginCall call) {
        String sourcePath = call.getString("sourcePath");
        if (sourcePath == null) {
            call.reject("sourcePath is required");
            return;
        }

        // Clean file:// prefix if present
        if (sourcePath.startsWith("file://")) {
            sourcePath = sourcePath.substring(7);
        }

        File sourceFile = new File(sourcePath);
        if (!sourceFile.exists()) {
            call.reject("Source file does not exist: " + sourcePath);
            return;
        }

        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(sourcePath);

            // Get video duration in milliseconds
            String durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            double durationSeconds = 0.0;
            if (durationStr != null) {
                durationSeconds = Double.parseDouble(durationStr) / 1000.0;
            }

            // Get first frame at t=0
            Bitmap bitmap = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            if (bitmap == null) {
                // Return gracefully without a thumbnail for files lacking an image frame (like audio)
                JSObject ret = new JSObject();
                ret.put("thumbnailPath", null);
                ret.put("duration", durationSeconds);
                call.resolve(ret);
                return;
            }

            Context context = getContext();
            File cacheDir = context.getCacheDir();
            String uniqueName = "thumbnail-" + UUID.randomUUID().toString() + ".jpg";
            File thumbnailFile = new File(cacheDir, uniqueName);

            try (FileOutputStream fos = new FileOutputStream(thumbnailFile)) {
                bitmap.compress(Bitmap.CompressFormat.JPEG, 80, fos);
            }

            JSObject ret = new JSObject();
            ret.put("thumbnailPath", thumbnailFile.getAbsolutePath());
            ret.put("duration", durationSeconds);
            call.resolve(ret);

        } catch (Exception e) {
            call.reject("Failed to extract thumbnail: " + e.getMessage(), e);
        } finally {
            try {
                retriever.release();
            } catch (IOException e) {
                // Ignore release errors
            }
        }
    }
}
