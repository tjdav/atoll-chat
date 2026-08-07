package com.atollchat.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import com.atollchat.plugins.AtollMediaPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AtollMediaPlugin.class);
        super.onCreate(savedInstanceState);

        try {
            SharedPreferences prefs = getSharedPreferences("atoll_app_prefs", Context.MODE_PRIVATE);
            int lastVersion = prefs.getInt("last_version_code", -1);
            PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            int currentVersion = pInfo.versionCode;

            if (lastVersion != currentVersion) {
                if (this.bridge != null && this.bridge.getWebView() != null) {
                    this.bridge.getWebView().clearCache(true);
                }
                prefs.edit().putInt("last_version_code", currentVersion).apply();
            }
        } catch (Exception e) {
            // Ignore error gracefully
        }
    }
}
