# Bundled PP-OCRv5 assets

These static inference assets are Apache-2.0 licensed PaddlePaddle releases. They are bundled so lecture frames never leave the device and runtime JavaScript is not fetched remotely.

| File | Upstream revision | SHA-256 |
| --- | --- | --- |
| `PP-OCRv5_mobile_det.onnx` | `PaddlePaddle/PP-OCRv5_mobile_det_onnx@e6f4fa8` | `A431985659DC921974177A95ADCFBB90FD9E51989A5E04D70D0B75F597B6E61D` |
| `korean_PP-OCRv5_mobile_rec.onnx` | `PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx@5c6f574` | `92F0B7785E64FC9090106A241CF4C1EB97472824558272751B88A2A4476D3A08` |

The adjacent `inference.yml` files are the upstream preprocessing and character-dictionary metadata. ONNX Runtime Web 1.29.0 is bundled under `lib/vendor/onnxruntime/` (MIT).
