---
name: buddy-multimodal-generation
description: "Generate 3D models or apply template-based image-to-video effects. Use ImageGen for image generation and VideoGen for general video generation."
---

# Multimodal Creation and Processing

Use `buddy-multimodal-generation.py` for the following tasks:

| Capability | Command |
|---|---|
| Image-to-video effects | `video-fx` |
| Text-to-3D or image-to-3D | `3d` |

## Routing Rules

- If the user provides an existing image and requests text or watermark removal, enhancement, beautification, restoration, or matting, stop using this skill and use `buddy-image-processing`.
- If the user requests a template-based image-to-video effect, use `video-fx`.
- If the user requests a 3D model, use `3d`.
- If the user requests text-to-image generation or generative image-to-image creation, stop using this skill and use `ImageGen`.
- If the user requests general text-to-video or image-to-video generation, stop using this skill and use `VideoGen`.

## Image-to-Video Effects

### Supported Capabilities

| Capability | Typical Effects | Representative Templates | Input Requirements |
|---|---|---|---|
| Character interaction | Kissing, making a heart, hugging, bridal carry, cheek-to-cheek | `kissing`, `hearting`, `hug`, `bridalcarry`, `cheeks` | One photo of two people or two single-person photos, depending on the template |
| Costume and transformation | Mecha, mermaid, Egyptian costume, cyberpunk, 3D figurine | `futuresoldier`, `mermaidme`, `egyptme`, `cyber`, `3dfigure` | Usually one portrait |
| Style transformation | Anime video, cartoon video, fuzzy style, ACG style | `animelive`, `cartoonlive`, `fuzzy`, `acgnme` | An image of a person, animal, or object |
| Motion and camera effects | Portrait motion, Live Photo, zoom in, zoom out, continuous story | `picmotion`, `livephoto`, `zoomin`, `zoomout`, `onestory` | One image; `onestory` requires 2 to 10 images |
| Physical and playful effects | Disintegration, inflation, flying away, dragging, strong wind, face pinching | `return2dust`, `morphlab`, `balloonfly`, `dragme`, `windonface`, `facepinch` | An image of a person, animal, or object, depending on the template |
| Pet effects | Pet hula dance, reindeer transformation, pet at work, pet carrying bricks | `petdance`, `reindeerme`, `petworking`, `petbricking` | Usually one cat or dog |
| Holiday and scene effects | Graduation, birthday, Christmas, Lunar New Year, Lantern Festival, fireworks photo | `graduation`, `birthdayme`, `xmasparty`, `springportrait`, `petfest`, `fireworksphoto` | A person or pet image, depending on the template |

Match the user's request to a template before running `video-fx`. If the template is uncertain, consult the [complete official template list](https://cloud.tencent.com/document/product/1616/119194). Never guess a `template` value.

```bash
python3 <SKILL_DIR>/scripts/buddy-multimodal-generation.py video-fx --template return2dust --image "https://example.com/photo.jpg" --token "<clientTempToken>"
python3 <SKILL_DIR>/scripts/buddy-multimodal-generation.py video-fx --template hug --image "https://example.com/a.jpg" --image "https://example.com/b.jpg" --token "<clientTempToken>"
```

## 3D Model Generation

### Supported Capabilities

| Capability | Parameter | Trigger or Purpose |
|---|---|---|
| Text-to-3D | `3d "prompt"` | Generate a 3D model from a text description |
| Image-to-3D | `3d --image-url URL` or `--image-base64 DATA` | Generate a 3D model from a single reference image |
| Multi-view-to-3D | `--multi-view JSON` | Supply left, right, back, top, bottom, or angled front views to improve structural information |
| PBR materials | `--enable-pbr` | Generate PBR materials for realistic lighting and rendering |
| Standard model | `--generate-type Normal` | Generate standard geometry and textures |
| Low-poly model | `--generate-type LowPoly --model 3.0` | Generate a low-face-count or game-style model |
| Geometry-only model | `--generate-type Geometry` | Generate geometry without textures |
| Sketch-to-3D | `--generate-type Sketch` | Generate a 3D model from a sketch |
| Face count control | `--face-count N` | Set the face count from 10000 to 1500000 |
| Output format | `--result-format STL|USDZ|FBX` | Add a format in addition to the default OBJ and GLB outputs |

```bash
python3 <SKILL_DIR>/scripts/buddy-multimodal-generation.py 3d "A chibi-style ancient lantern" --enable-pbr --token "<clientTempToken>"
python3 <SKILL_DIR>/scripts/buddy-multimodal-generation.py 3d --image-url "https://example.com/image.jpg" --token "<clientTempToken>"
```

Model `3.1` does not support `LowPoly`. 3D generation usually takes 1 to 5 minutes.

## Execution Flow

1. Call `connect_cloud_service` once before each task.
2. Read only the `clientTempToken` returned for the current task and pass it through `--token`. Stop immediately if the field is missing.
3. Run the selected command once. The script polls every 5 seconds by default for up to 600 seconds.
4. If the command times out after returning a `job_id`, query only that original job with `status <job_id> --type 3d|video-fx`; do not run the generation command again.

   ```bash
   python3 <SKILL_DIR>/scripts/buddy-multimodal-generation.py status "<job_id>" --type 3d --token "<clientTempToken>"
   ```

5. Download remote video and 3D artifacts to the current working directory.
6. Use `present_files` to display local files and return their full local paths to the user.

Never display, explain, cache, or reuse authentication credentials.

## Retry Rules

- Never use an external `sleep` loop to resubmit the same task.
- After receiving a task ID, only query the original task. If authentication expires, authenticate again without resubmitting.
- Resubmit a 3D or video-effect task at most once.
- Return the actual error when a call fails. Never fabricate results or URLs.

## Artifact Handling

- Video: read `result_url` and download it as `generated_video_<timestamp>.mp4`.
- 3D: download models and preview images from `result_files`, preferring GLB for display.
- Download every remote artifact locally before returning it. Never return a remote URL as the final result.
- If a download fails, explain the cause and provide the original URL for manual download.

After generating a 3D model, create `generated_model_<timestamp>_viewer.html` beside the GLB. Use `model-viewer` and reference the model with a relative path. Pass the absolute path of `viewer.html` to `present_files` so the ClawClaw built-in preview service serves the HTML and GLB from the same origin. Do not use `file://` or start an HTTP server manually.

## Script Execution

Always use the script under the current skill directory:

```text
<SKILL_DIR>/scripts/buddy-multimodal-generation.py
```

Do not guess the ClawClaw installation directory or manually construct an `app.asar` path. If `python3` is unavailable, try `python`. If neither is available, stop and do not install a runtime automatically.

## First-Run Demo

If the user only says "try it" or "show me what it can do", demonstrate 3D model generation first. Create a concise prompt and run it directly. After completion, briefly mention image processing and image-to-video effects.

## Dependencies

- Python 3.7+
- `requests`, installed automatically by the script when missing
