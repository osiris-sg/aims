package so.osiris.aims.field;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom plugins register BEFORE super.onCreate so the bridge picks
        // them up on WebView init.
        registerPlugin(BtPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
