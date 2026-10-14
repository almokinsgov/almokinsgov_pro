# ReoRite Scan 1.1.0

This is the complete flat Scan app: all HTML, JavaScript, OCR models, WASM, notices and Windows launchers are in this directory. Keep every file together. No dashboard, extension, npm installation or external OCR service is needed to run it.

On Windows with Node.js 22 or newer:

```bat
start.cmd
```

Open **http://localhost:5534/**. Use **start-network.cmd** for your network; the terminal prints LAN URLs. Ctrl+C stops the server. You can copy this entire directory to another computer or deploy it on a standard static web server.

For a supplied trusted HTTPS certificate pair:

```bat
start-network.cmd --cert "D:\path\certificate.pem" --key "D:\path\private-key.pem"
```

Keep private keys outside this public directory. Live camera and Polly need HTTPS on remote devices; localhost works over HTTP. Image import and available device voices work on HTTP. Take photo opens native capture on supported devices. No firewall or certificate trust changes are made by the scripts.

Choose Camera, Import image or Try a sample; use Whole frame or Draw rectangle, then Scan text. Hover, tap or hold green text for pronunciation and word/line playback. Play te reo and Play all text are also available. Scan 1.1 removes the Review tab and OCR editing workflow. OCR confidence is shown in word details.

Settings include Māori/English best/fast OCR, layout, contrast, camera preference, detection threshold/mode, lexicons and replacement text. Edit Ambiguous and Particle token lists using spaces, commas or new lines. Empty lists are supported. Device speech uses installed voices; Polly uses lexicon IPA, rate/separator/compact SSML options and an optional Remove lower articulation IPA marks setting. That option strips U+031E and U+02D5 only from playback SSML, preserving displayed IPA.

AWS keys can be used for this tab, or saved with **Save AWS keys locally in this browser**. Saved keys load after reopening at the same origin. **Clear keys** removes active and saved keys. Stored keys are in browser local storage, accessible to this browser profile and code at this origin; use your own device. Keys are separate from settings and excluded from exports and this package. Only text you choose to play is sent to AWS. Browser storage clearing also removes saved settings/lexicons/keys. Temporary AWS credentials still expire and need replacement.

Images and OCR results stay in memory; settings and imported lexicons persist in browser storage. JSON/TSV lexicons can be added, selected, renamed, exported and removed in Settings. Default pronunciation uses V6.5. Export lexicons separately from settings. Export recognized text saves OCR words and bounding boxes without images or keys.

Static hosting: preserve all filenames, serve `.wasm` as `application/wasm`, and serve model `.traineddata.gz` files without `Content-Encoding: gzip` because Tesseract decompresses them. Directory URLs must resolve to index.html. Use HTTP/HTTPS, not file://. This release does not install offline caching. OCR models/workers are local; camera optics and installed voice quality depend on the device.

Image limits: 25 MB, 32 megapixels, with larger images reduced to 3200 pixels on their longest edge. Printed text works best with good focus and lighting. Re-scan a tighter region if OCR misses letters/macrons. Open-source license notices and pinned model/runtime hashes are included alongside the app in this flat directory.

Project development commands remain under Projects\reorite3\script: build-scan.cmd, test-scan.cmd and backup.cmd. They are not required to run this copied release folder.
