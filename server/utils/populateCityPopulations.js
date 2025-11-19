// server/utils/populatePopulations.js
// Reads the prepared CSV file containing city IDs and population data
// and performs a targeted update on the local database.

const fs = require('fs');
const path = require('path');
// FIX: csv-parser exports a function directly.
const csvParser = require('csv-parser'); 
const postgres = require('postgres');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// --- Database Connection Setup ---
let sql;

sql = postgres({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    onnotice: () => {},
});
// --- End DB Setup ---

const csvFileName = 'to_add_database_population.csv'; 
const csvFilePath = path.join(__dirname, csvFileName);

async function runPopulationUpdate() {
    console.log(`Starting population update from ${csvFileName}...`);
    // CRITICAL FIX: Store data objects, not pre-built queries, to solve the 't.query is not a function' error.
    const updates = []; 
    let processedCount = 0;
    let successCount = 0;
    let initialLog = true; 
    
    if (!fs.existsSync(csvFilePath)) {
        console.error(`\n❌ CRITICAL: CSV file not found at path: ${csvFilePath}`);
        return;
    }

    await new Promise((resolve, reject) => {
        fs.createReadStream(csvFilePath)
            .pipe(csvParser({ 
                // Using custom headers based on your last debug output
                headers: ['database_id_key', 'population_key', '_2', '_3', '_4'], 
                skipLines: 1 // Skip the header row
            }))
            .on('data', (row) => {
                processedCount++;
                
                // --- DEBUGGING STEP 1: Log Headers and First Row ---
                if (initialLog) {
                    console.log('\n--- DEBUG: CSV ROW 1 DATA ---');
                    console.log('EXPECTED KEYS: database_id_key, population_key');
                    console.log('ACTUAL ROW KEYS (after skip):', Object.keys(row));
                    console.log('ROW 1 VALUES:', row);
                    console.log('------------------------------\n');
                    initialLog = false;
                }
                
                // --- CRITICAL DATA EXTRACTION ---
                const id = parseInt(row.database_id_key, 10);
                const pop = parseInt(row.population_key, 10);

                if (!isNaN(id) && pop > 0) {
                    // STORE DATA OBJECT: Only store the necessary ID and Population
                    updates.push({ id, pop });
                } else {
                    // --- DEBUGGING STEP 2: Log Invalid Rows (First 10) ---
                    if (processedCount <= 10) {
                        console.warn(`[DEBUG WARNING] Skipping row ${processedCount}: ID=${row.database_id_key} (Parsed: ${id}) or POP=${row.population_key} (Parsed: ${pop}) is invalid/missing.`);
                    }
                }
            })
            .on('end', async () => {
                console.log(`CSV reading complete. Processed ${processedCount} rows.`);
                console.log(`Successfully generated ${updates.length} update queries.`);
                
                if (updates.length === 0) {
                    console.log('No valid update queries were generated. Check debug output above.');
                    return resolve();
                }

                try {
                    const batchSize = 1000; 
                    
                    // Transaction start
                    await sql.begin(async t => {
                        for (let i = 0; i < updates.length; i += batchSize) {
                            const batchData = updates.slice(i, i + batchSize);
                            console.log(`Executing batch ${i / batchSize + 1} (${batchData.length} updates)...`);
                            
                            // CRITICAL FIX: Construct the query using the transaction object (t)
                            // and the data object inside the batch map.
                            const batchPromises = batchData.map(data => t`
                                UPDATE cities
                                SET population = ${data.pop}
                                WHERE id = ${data.id}
                            `);
                            
                            // Execute the batch of promises
                            const results = await Promise.all(batchPromises);
                            
                            successCount += results.reduce((sum, res) => sum + res.count, 0);
                        }
                    }); // Transaction end
                    
                    console.log(`\n✅ Population data successfully loaded into the database!`);
                    console.log(`Total cities found and updated: ${successCount}`);
                    resolve();
                } catch (error) {
                    // The transaction will automatically roll back here
                    console.error('\n❌ Database update FAILED. Transaction aborted:', error.message);
                    reject(error);
                } finally {
                    await sql.end();
                }
            })
            .on('error', (error) => {
                console.error('\n❌ Error reading CSV file:', error.message);
                reject(error);
            });
    });
}

runPopulationUpdate().catch(err => {
    console.error('Script terminated with error:', err.message);
});