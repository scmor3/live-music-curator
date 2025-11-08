// This is a ONE-TIME script to populate our 'cities' table from a CSV.
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const postgres = require('postgres');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// --- Database Connection ---
const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  onnotice: () => {},
  max: 1,
};

const sql = postgres(dbConfig);
console.log('Connecting to database...');

// --- Helper Functions ---
function getSmartName(row) {
  const city = row.city_ascii || '';
  const admin = row.admin_name || '';
  const country = row.country || '';

  if (country === 'United States' && admin) {
    return `${city}, ${admin}`; // e.g., "Austin, Texas"
  }
  return `${city}, ${country}`; // e.g., "Paris, France" or "Tel Aviv, Israel"
}
function getSpecificName(row) {
  const city = row.city_ascii || '';
  const admin = row.admin_name || '';
  const country = row.country || '';
  return [city, admin, country].filter(Boolean).join(', '); 
}

// --- Main Seeding Logic ---
async function seedDatabase() {
  try {
    await sql`SELECT 1`; // Test the connection
    console.log('Database connected. Starting to read worldcities.csv...');
    
    const allRows = [];
    const nameCounts = new Map();
    const citiesToInsert = [];

    const csvFilePath = path.resolve(__dirname, '../worldcities.csv');

    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        // --- PASS 1: Read all rows and count "simple" names ---
        if (row.city_ascii && row.lat && row.lng) {
          allRows.push(row);
          const simpleName = getSmartName(row);
          nameCounts.set(simpleName, (nameCounts.get(simpleName) || 0) + 1);
        }
      })
      .on('end', async () => {
        console.log(`CSV file successfully processed. Found ${allRows.length} total rows.`);

        // --- PASS 2: Loop through all rows and build the final name ---
        for (const row of allRows) {
          const simpleName = getSmartName(row);
          let finalName;

          if (nameCounts.get(simpleName) > 1) {
            finalName = getSpecificName(row);
          } else {
            finalName = simpleName;
          }
          
          const newCity = {
            name: finalName,
            city: row.city_ascii || '',
            admin_name: row.admin_name || '',
            country: row.country || '',
            latitude: parseFloat(row.lat),
            longitude: parseFloat(row.lng),
          };
          
          citiesToInsert.push(newCity);
        }
        
        console.log(`Processed ${citiesToInsert.length} cities with smart names.`);
        
        if (citiesToInsert.length === 0) {
          console.log('No cities to insert. Check your CSV file path.');
          await sql.end();
          return;
        }

        // --- PASS 3: Insert into the database ---
        console.log('Inserting cities into database... This may take a minute.');

        let insertedCount = 0;
        // We will loop through each city and insert it ONE BY ONE.
        for (const city of citiesToInsert) {
          try {
            await sql`
              INSERT INTO cities (
                name, 
                city,
                admin_name,
                country,
                latitude,
                longitude
              )
              VALUES (
                ${city.name},
                ${city.city},
                ${city.admin_name},
                ${city.country},
                ${city.latitude},
                ${city.longitude}
              )
              ON CONFLICT (name) DO NOTHING
            `;
            insertedCount++;
            if (insertedCount % 1000 === 0) {
              console.log(`... inserted ${insertedCount} / ${citiesToInsert.length} cities ...`);
            }
          } catch (insertError) {
            console.error(`Failed to insert city: ${city.name}`, insertError.message);
            // We'll log the error but continue, so one bad row doesn't
            // stop the whole script.
          }
        }
        
        console.log(`✅ Database seeding complete! Inserted ${insertedCount} cities.`);
        await sql.end();
        console.log('Database connection closed.');
      })
      .on('error', (error) => {
        throw error;
      });

  } catch (error) {
    console.error('Error during database seeding:', error.message);
    await sql.end();
    process.exit(1);
  }
}

seedDatabase();