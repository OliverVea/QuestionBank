# figure-matching test cases

Fixtures for the **figure → question matching** step (step 3 of figure extraction —
intentionally *not* part of `services/figure-service`, see
`docs/investigations/figure-extraction.md`). The image half (dewarp + figure
detection) already runs as `figure-service`; these cases capture its output on real
page photos so the matcher can be developed/tested offline against fixed inputs.

## How these were generated

The 6 source photos in `experiments/figure-segmentation/samples/` were POSTed through
the **deployed** figure-service (`POST /v1/process` on `apps-beta`, image
`questionbank-figures:20260620-052603`) and the responses split into per-case folders.
Inputs were renamed `test_1.jpg` … `test_6.jpg`; see `index.json` for the mapping.

## Layout

```
cases/test_N/
  test_N.jpg          original page photo (renamed source)
  rectified.jpg       dewarped page from /v1/process (re-encoded JPEG q92 from the API PNG)
  figures.json        { source, rectified:{width,height}, figures:[{id,cls,score,box,corners,crop}] }
  crops/figure_K.jpg  each detected figure, cropped from rectified.jpg by its box
index.json            test_N -> source filename + figure count
```

`box` = `[x1,y1,x2,y2]` and `corners` are **pixels in the rectified image** (not the
original photo). Crops are derived from `box`.

## Regenerate

Re-run the 6 images through the service and rebuild the folders (requires cluster
access to `apps-beta`; the service is ClusterIP-only). The original orchestration:
copy images to a pod, `curl -F file=@… -H "X-API-Key: <figure-service-auth>" $SVC/v1/process`,
then decode `rectified.png_base64` and crop each `figures[].box`.

## Detected figure counts

| case | source | figures |
| ---- | ------ | ------- |
| test_1 | PXL_20260619_123302708.jpg | 4 |
| test_2 | PXL_20260619_131203627.jpg | 4 |
| test_3 | PXL_20260619_131215689.jpg | 6 |
| test_4 | PXL_20260619_131225663.jpg | 7 |
| test_5 | PXL_20260619_131245144.jpg | 11 |
| test_6 | PXL_20260619_131256166.jpg | 10 |
