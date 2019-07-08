# auth0-bulk-delete
Bulk delete for users/clients/resource-servers/client-grants/device-credentials/connections

<strong>--- H A N D L E - W I T H - C A R E ! ---</strong>

## Usage

```
./bulk-delete.js --help
Usage: bulk-delete.js --mode=[users|clients|resource-servers|device-credentials|
client-grants|connections] --concurrent=[num|5] --delay=[num|333]
--retry=[num|3]

Options:
  --help        Show help                                              [boolean]
  --version     Show version number                                    [boolean]
  --mode        Entity type you want to delete               [string] [required]
  --prompt      Show warning prompt                    [boolean] [default: true]
  --concurrent  Max concurrent reqs (1..20)                [number] [default: 5]
  --delay       Min delay (ms) betn reqs (300..3000)     [number] [default: 333]
  --retry       Num retries for HTTP429 reqs (1..5)        [number] [default: 3]
  ```

## Comments

1. IDs for entities to be deleted must be provided in `entity_ids.delete` file.
2. Type of the entity to be deleted must be provided as `mode` cli argument (this is the only *REQUIRED* arg).
3. Provide values for `concurrent` and `delay` args suitable to rate-limits on your tenant.
4. In spite of the above, if we hit HTTP 429 (rate limit exceeded) error, then script will retry for `retry` number of times.
5. In spite of retries, if a particular request(s) fails, it will be logged in `failures.log` file and can be re-attempted later.
