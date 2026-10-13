- pngz is patent-free
- licensed under zlib license
- not getting any c libraries
- intended for efficient storage purposes
- pngz has almost no CVEs. at worst, it can freeze or crash. Because of the JS/WASM sandbox, no server side issues, etc.,
- can work offline. just type:
```bash
git clone https://github.com/pngz-dev/pngz.git
cd pngz
python -m http.server 8080
```
and visit localhost:8080. Doesn't imports any CDNs or anything that requires internet.
