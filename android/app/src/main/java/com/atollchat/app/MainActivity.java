package com.atollchat.app;

import android.os.Bundle;
import com.atollchat.plugins.AtollMediaPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AtollMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
