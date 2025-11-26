# Use the official Playwright image which includes all OS dependencies
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

# Set the working directory inside the container
WORKDIR /app

# Copy dependency definitions first (caching layer)
COPY package.json package-lock.json ./

# Install project dependencies (including 'got-scraping', etc.)
RUN npm install

# Copy the rest of your server code
COPY . .

# Expose the port your app runs on
EXPOSE 8080

# Start the server
CMD ["node", "index.js"]