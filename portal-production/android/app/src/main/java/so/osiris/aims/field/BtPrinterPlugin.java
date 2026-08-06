package so.osiris.aims.field;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

/**
 * BtPrinter — minimal Classic-Bluetooth SPP bridge for 58mm ESC/POS receipt
 * printers (Xprinter XP-58IIH and friends). Web Bluetooth is BLE-only by
 * spec and can never reach SPP, hence this native plugin.
 *
 *   listBonded() → [{name, mac}]   (pairing itself happens in Android Settings)
 *   connect(mac)                    RFCOMM socket on the standard SPP UUID
 *   write(base64)                   CHUNKED ~512B with small delays — SPP
 *                                   printers overrun on large single writes
 *   disconnect()
 *
 * All socket work runs off the WebView thread. BLUETOOTH_CONNECT is requested
 * at runtime on API 31+; below that the legacy manifest permissions suffice.
 */
@CapacitorPlugin(
    name = "BtPrinter",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class BtPrinterPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int CHUNK_SIZE = 512;
    private static final int CHUNK_DELAY_MS = 25;

    private BluetoothSocket socket;
    private OutputStream out;

    private boolean needsRuntimePermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && getPermissionState("bluetooth") != com.getcapacitor.PermissionState.GRANTED;
    }

    // ── listBonded ───────────────────────────────────────────────────────────
    @PluginMethod
    public void listBonded(PluginCall call) {
        if (needsRuntimePermission()) {
            requestPermissionForAlias("bluetooth", call, "listBondedAfterPermission");
            return;
        }
        doListBonded(call);
    }

    @PermissionCallback
    private void listBondedAfterPermission(PluginCall call) {
        if (needsRuntimePermission()) {
            call.reject("Bluetooth permission denied");
            return;
        }
        doListBonded(call);
    }

    private void doListBonded(PluginCall call) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) { call.reject("This device has no Bluetooth"); return; }
            if (!adapter.isEnabled()) { call.reject("Bluetooth is turned off"); return; }
            JSArray devices = new JSArray();
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            for (BluetoothDevice d : bonded) {
                JSObject o = new JSObject();
                o.put("name", d.getName() != null ? d.getName() : d.getAddress());
                o.put("mac", d.getAddress());
                devices.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Bluetooth permission denied");
        } catch (Exception e) {
            call.reject("listBonded failed: " + e.getMessage());
        }
    }

    // ── connect ──────────────────────────────────────────────────────────────
    @PluginMethod
    public void connect(PluginCall call) {
        String mac = call.getString("mac");
        if (mac == null || mac.isEmpty()) { call.reject("mac is required"); return; }
        if (needsRuntimePermission()) {
            requestPermissionForAlias("bluetooth", call, "connectAfterPermission");
            return;
        }
        doConnect(call, mac);
    }

    @PermissionCallback
    private void connectAfterPermission(PluginCall call) {
        if (needsRuntimePermission()) { call.reject("Bluetooth permission denied"); return; }
        doConnect(call, call.getString("mac"));
    }

    private void doConnect(PluginCall call, String mac) {
        new Thread(() -> {
            try {
                closeQuietly();
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null || !adapter.isEnabled()) { call.reject("Bluetooth is unavailable or off"); return; }
                BluetoothDevice device = adapter.getRemoteDevice(mac);
                adapter.cancelDiscovery(); // discovery kills RFCOMM connects
                BluetoothSocket s = device.createRfcommSocketToServiceRecord(SPP_UUID);
                s.connect();
                socket = s;
                out = s.getOutputStream();
                call.resolve();
            } catch (SecurityException e) {
                call.reject("Bluetooth permission denied");
            } catch (Exception e) {
                closeQuietly();
                call.reject("Could not connect to the printer: " + e.getMessage());
            }
        }).start();
    }

    // ── write ────────────────────────────────────────────────────────────────
    @PluginMethod
    public void write(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null) { call.reject("base64 is required"); return; }
        new Thread(() -> {
            try {
                if (out == null) { call.reject("Not connected — call connect(mac) first"); return; }
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                // Chunked writes: SPP printer buffers are tiny; a single large
                // write drops bytes mid-receipt on most cheap 58mm units.
                for (int off = 0; off < bytes.length; off += CHUNK_SIZE) {
                    int len = Math.min(CHUNK_SIZE, bytes.length - off);
                    out.write(bytes, off, len);
                    out.flush();
                    Thread.sleep(CHUNK_DELAY_MS);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Write failed: " + e.getMessage());
            }
        }).start();
    }

    // ── disconnect ───────────────────────────────────────────────────────────
    @PluginMethod
    public void disconnect(PluginCall call) {
        new Thread(() -> {
            closeQuietly();
            call.resolve();
        }).start();
    }

    private void closeQuietly() {
        try { if (out != null) out.close(); } catch (Exception ignored) {}
        try { if (socket != null) socket.close(); } catch (Exception ignored) {}
        out = null;
        socket = null;
    }
}
