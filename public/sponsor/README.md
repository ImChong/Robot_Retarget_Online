# Sponsor QR · 赞助收款码

The "赞助 / Sponsor" button in the top app bar opens a popup that displays
`wechat-pay.png` from this folder.

`wechat-pay.png` currently holds a **placeholder** image. Replace it with your
real WeChat payment QR code, keeping the same filename and path:

```
public/sponsor/wechat-pay.png
```

Tips:

- A portrait PNG (e.g. the standard WeChat「收款码」screenshot) looks best; the
  popup scales it to a max width of 260px.
- No code change is needed — the app references this exact path
  (`<base>/sponsor/wechat-pay.png`), so just overwrite the file and redeploy.
