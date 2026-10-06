# Explicit synthetic preparation fixture

- 분야: 머신러닝
- 작업: GP-0077

All six CSV files contain invented observations and anonymous fixture identities. No camera,
participant, video, landmark, measured performance, or trained model data was used.
`explicit-synthetic-pose-v0` is a fixture marker; both landmark JSON fields are empty arrays.
The reviewed labels demonstrate filtering/provenance and do not assert classification accuracy.

`config.json` records the exact SHA-256 of each file. Three invented participants have separate
calibration/posture captures and explicit train/validation/test assignments. P03 is evaluation-only.
The irregular timestamps, 500ms target, 500ms stride, 400ms maximum gap, and three-observation
minimum are test inputs, not frozen research parameters.

Run the CLI with a new ignored or external output directory as described in
[the preparation guide](../../../../docs/research/dataset-preparation.md).
