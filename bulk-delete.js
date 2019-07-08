#!/usr/bin/env node

// requires
const dotenv = require('dotenv')
const request = require('request-promise')
const argv = require('yargs')
    .options({
        mode: { type: 'string', describe: 'Entity type you want to delete', demandOption: true },
        prompt: { default: true, type: 'boolean', describe: 'Show warning prompt' },
        concurrent: { default: 5, type: 'number', describe: 'Max concurrent reqs (1..20)' },
        delay: { default: 333, type: 'number', describe: 'Min delay (ms) betn reqs (300..3000)' },
        retry: { default: 3, type: 'number', describe: 'Num retries for HTTP429 reqs (1..5)' }
    }).usage('Usage: $0 --mode=[users|clients|resource-servers|device-credentials|client-grants|connections] --concurrent=[num|5] --delay=[num|333] --retry=[num|3]')
    .argv;
const bottleneck = require('bottleneck');
const prompt = require('prompt-promise');
const fs = require('fs');
const os = require('os');
const validator = require('node-input-validator');
 
// properties
dotenv.config();
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;
const AUTH0_CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET;

// cmdline args
const MODE = argv.mode;
const MAX_CONCURRENT_REQUESTS = argv.concurrent;
const MIN_DELAY_REQUESTS = argv.delay;
const RETRY_COUNT = argv.retry;
const PROMPT = argv.prompt;

// other constants
const FAILURE_LOG = 'failures.log';

// just summary of inputs/defaults used
console.debug(`
    Entity type you want to delete: ${MODE},
    Max concurrent requests: ${MAX_CONCURRENT_REQUESTS},
    Min delay between requests: ${MIN_DELAY_REQUESTS},
    Number of retry attempts for HTTP 429 failed requests: ${RETRY_COUNT},
    Show delete warning prompt: ${PROMPT} 
`);

// rate limit sending of requests
var limiter = new bottleneck({
    maxConcurrent: MAX_CONCURRENT_REQUESTS,
    minTime: MIN_DELAY_REQUESTS
});

// listen to "failed" event, then retry
limiter.on("failed", (error, jobInfo) => {
    const id = jobInfo.options.id;

    if (error.statusCode === 429) {
        if(jobInfo.retryCount < RETRY_COUNT) { // max-retry-attempts
            console.warn(`[${id}] failed - will be retried in ${MIN_DELAY_REQUESTS} ms!`);
            return MIN_DELAY_REQUESTS;
        } else {
            console.error(`[${id}] failed - in spite of max retries`)
            logToFileAsPromised(FAILURE_LOG, `${id},${error.statusCode}`)
        }
    } else {
        console.error(`[${id}] failed - will NOT be retried as error isn't 429 but ${error.statusCode}`)
        logToFileAsPromised(FAILURE_LOG, `${id},${error.statusCode}`)
    }
});

// listen to the "retry" event
limiter.on("retry", (error, jobInfo) => {
    console.log(`Now retrying ${jobInfo.options.id}`)
});

// acquire mgmt api access_token
let acquireAccessToken = () => {

    console.log('acquiring access_token for mgmt-api');
    
    var options = {
        method: 'POST',
        url: `https://${AUTH0_DOMAIN}/oauth/token`,
        headers: {
            'content-type': 'application/json'
        },
        body: `{
            "client_id":"${AUTH0_CLIENT_ID}",
            "client_secret":"${AUTH0_CLIENT_SECRET}",
            "audience":"https://${AUTH0_DOMAIN}/api/v2/",
            "grant_type":"client_credentials",
            "scope":"delete:${MODE.replace('-', '_')} read:${MODE.replace('-', '_')}"
        }`    
    };

    // promise
    return request(options);
}

// fetch ids to be deleted, from file
let readEntityIdsToBeDeleted = () => {
    const fs = require('fs');
    return new Promise((resolve, reject) => {
        fs.readFile('entity_ids.delete', (error, data) => {
            if(error) reject(error);
            resolve(
                data.toString()
                    .split(os.EOL)
                    .filter(element => !element.startsWith("#"))
            );
        });
    });
}

// actual work
let bulkDelete = (entityIdArray, accessToken) => {
    let options = {
        method: 'delete',
        auth: { 'bearer': accessToken }, 
        resolveWithFullResponse: true
    };

    Promise.all(
        entityIdArray.map(entityId => {
            let uri = `https://${AUTH0_DOMAIN}/api/v2/${MODE}/${entityId}`;
            return limiter.schedule({ id: entityId }, request, uri, options)
                            .then(response => console.info(response.statusCode))
                            .catch(error => {});
        })
    );
}

// write to csv-file
let logToFileAsPromised = (path, data) => {
    return new Promise((resolve, reject) => {
        fs.appendFile(path, data + os.EOL, {flag: 'w'}, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

// truncate csv file
let truncateFileAsPromised = path => {
    return new Promise((resolve, reject) => {
        fs.truncate(path, 0, (error) => {
            if (error) reject(error);
            else {
                console.debug(`truncated ${path}`)
                resolve();
            }
        });
    });
}

// input valiations
let inputValidator = async () => {
    
    // input valiation check
    let mode = new validator({mode: MODE}, {mode: 'required|in:users,clients,resource-servers,device-credentials,client-grants,connections'});
    let concurrent = new validator({concurrent: MAX_CONCURRENT_REQUESTS}, {concurrent: 'required|between:1,20'});
    let retry = new validator({retry: RETRY_COUNT} ,{retry: 'required|between:0,5'});
    let delay = new validator({delay: MIN_DELAY_REQUESTS}, {delay: 'required|between:300,3000'});
    let checks = [mode, concurrent, retry, delay];

    Promise
        .all(checks.map(check => check.check()))
        .then(values => {
            if(values.includes(false)) {
                console.error(checks[values.indexOf(false)].errors);
                console.error('see usage: ./bulk-delete.js --help');
                process.exit(1);
            }
        }).catch(error => {
            console.error('error performing validation check', error.message);
            process.exit(1);
        });
}

// main entry point
let main = async () => {
    
    // 0-validate input args
    inputValidator();

    await logToFileAsPromised(FAILURE_LOG, `# Failed ${MODE} deletion (if any) will be recoded below:`);

    // 2-acquire mgmt api access_token
    let accessTokenPromise = acquireAccessToken();

    // 3-fetch ids to be deleted
    let entityIdArrayPromise = readEntityIdsToBeDeleted();

    Promise
        .all([accessTokenPromise, entityIdArrayPromise])
        .then(async values => {
            
            let accessToken = JSON.parse(values[0]).access_token;
            console.debug('accessToken: ', accessToken);
            
            let entityIdArray = values[1];
            entityIdArray.forEach(element => {
                console.debug(element);
            });

            if(PROMPT) {
                await prompt(`
                You are DELETING ${entityIdArray.length} ${MODE} from ${AUTH0_DOMAIN}!
                This CANNOT be undone.
                If you wish to proceed please type in tenant shortname ${AUTH0_DOMAIN.split('.')[0]}: `)
                .then(input => {
                        prompt.finish();
                        if(input !== AUTH0_DOMAIN.split('.')[0]) {
                            console.info(`received ${input}, exiting!`);
                            process.exit(1);
                        }
                    });
            }

            // 4-bulk delete
            await bulkDelete(entityIdArray, accessToken);
        }).catch(error => {
            console.error('[fatal] Cannot continue: ', error.message);
        });
}

main();