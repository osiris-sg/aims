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
    // After the final chunk, hold before returning so the printer drains the
    // tail over-air. Without this, a following disconnect()/socket.close()
    // discards undrained RFCOMM bytes and the receipt is cut off mid-tail.
    private static final int DRAIN_DELAY_MS = 600;
    // Let the freshly-opened RFCOMM link settle before the first bytes — the
    // first print after connecting otherwise races link setup and the printer
    // emits a garbled leading block.
    private static final int CONNECT_SETTLE_MS = 300;
    // Pause after the on-connect buffer-clear so it takes effect before the job.
    private static final int BUFFER_CLEAR_SETTLE_MS = 150;
    // Sent on connect to discard anything left in the printer from a prior job
    // BEFORE the new receipt starts — otherwise a previous job's unprinted tail
    // (raster payload) is flushed at the head of THIS job and prints as ASCII.
    //   DLE ENQ 2 (0x10 0x05 0x02) — real-time "clear receive + print buffers".
    //   ESC @      (0x1B 0x40)      — reset formatting to a known state.
    // Harmless on printers that ignore DLE ENQ (control bytes, not printed).
    private static final byte[] CLEAR_ON_CONNECT = { 0x10, 0x05, 0x02, 0x1B, 0x40 };

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
            call.reject("Bluetooth permission was not granted (listBonded) — allow it in Settings > Apps > AIMS Field > Permissions");
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
            call.reject("Bluetooth permission error (listBonded): " + e.getMessage());
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
        if (needsRuntimePermission()) { call.reject("Bluetooth permission was not granted (connect) — allow it in Settings > Apps > AIMS Field > Permissions"); return; }
        doConnect(call, call.getString("mac"));
    }

    private void doConnect(PluginCall call, String mac) {
        new Thread(() -> {
            try {
                closeQuietly();
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null || !adapter.isEnabled()) { call.reject("Bluetooth is unavailable or off"); return; }
                BluetoothDevice device = adapter.getRemoteDevice(mac);
                // Defensive only — an in-flight discovery scan slows/kills RFCOMM
                // connects. We never start discovery ourselves, and cancelDiscovery()
                // requires BLUETOOTH_SCAN (which this plugin neither declares nor
                // requests), so a missing-permission SecurityException here must NOT
                // abort the connect — the RFCOMM connect below needs only the already-
                // granted BLUETOOTH_CONNECT.
                try { adapter.cancelDiscovery(); } catch (SecurityException ignored) {}
                BluetoothSocket s = device.createRfcommSocketToServiceRecord(SPP_UUID);
                s.connect();
                socket = s;
                out = s.getOutputStream();
                // Settle before the caller's first write() — see CONNECT_SETTLE_MS.
                Thread.sleep(CONNECT_SETTLE_MS);
                // Discard any leftover buffer from a prior job before it can be
                // flushed at the head of the next receipt — see CLEAR_ON_CONNECT.
                out.write(CLEAR_ON_CONNECT);
                out.flush();
                Thread.sleep(BUFFER_CLEAR_SETTLE_MS);
                call.resolve();
            } catch (SecurityException e) {
                call.reject("Bluetooth permission error (connect): " + e.getMessage());
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
                // Chunk the write() syscall (SPP buffers are small) but with NO
                // inter-chunk delay: a temporal gap INSIDE a raster command
                // (GS v 0) makes cheap 58mm firmware time out waiting for image
                // data and revert to text mode — printing the raster bytes as
                // ASCII. Back-to-back writes form one continuous wire stream
                // (RFCOMM doesn't preserve write-call boundaries as gaps), so
                // every ESC/POS command arrives intact. RFCOMM credit-based
                // flow control provides the backpressure the old sleep faked.
                // The loop covers the whole array — the last iteration's len is
                // the final partial chunk (min(CHUNK_SIZE, remaining)).
                for (int off = 0; off < bytes.length; off += CHUNK_SIZE) {
                    int len = Math.min(CHUNK_SIZE, bytes.length - off);
                    out.write(bytes, off, len);
                }
                // Drain the tail before resolving — the caller calls disconnect()
                // right after this resolves, and socket.close() would otherwise
                // cut any bytes still in flight (recipient name + trailing feed).
                out.flush();
                Thread.sleep(DRAIN_DELAY_MS);
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
