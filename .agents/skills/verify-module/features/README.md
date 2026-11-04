# Feature map

One file per feature. `covers:` lists the source globs it owns, `docs:` the pages a verdict judges, `journeys:` the journeys it runs, and `seeded-breaks/<feature>.patch` the break its journeys must catch. `pnpm exec antelopejs-verify map` checks that every user-facing file is covered.

Storage is Moto 5.2.3 in Docker. Journeys PUT with `curl`, as a browser would, and read state back with boto3 inside the container. `WriteFile` and `ReadFile` pass bytes and a stream that the JSON driver cannot carry, so only the module's own mocha suite covers them.

| Feature | What the user does | Journeys |
|---|---|---|
| [upload](upload.md) | Asks for a presigned upload URL under size and type limits and uploads to it. | upload-presigned, upload-validation |
| [objects](objects.md) | Checks, describes, links, moves and deletes a stored file. | objects-lifecycle |
| [visibility](visibility.md) | Stores a file privately, in a bucket the module first checks. | private-routing, private-bucket-guard |
| [staging](staging.md) | Uploads to staging and promotes the file. | promote-staged, promote-conflict |
| [lifecycle](lifecycle.md) | Has the module expire the staging prefix. | lifecycle-rule |
| [storages](storages.md) | Selects a named storage. | named-storage |
| [smoke](smoke.md) | The fixed journey every verdict runs. | module-dev, upload-through-moto |
