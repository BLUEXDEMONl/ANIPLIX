
const express = require('express');
const axios = require('axios');
const path = require('path');
const cheerio = require('cheerio');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

const DB_DIR = path.join(__dirname, 'database');
const DB_PATH = path.join(DB_DIR, 'db.json');

// Cache for anime suggestions
let cachedSuggestions = null;
let suggestionsCacheTimestamp = 0;
const SUGGESTIONS_CACHE_DURATION = 3 * 60 * 1000; // 3 minutes in milliseconds

const initializeDatabase = async () => {
    try {
        if (!fs.existsSync(DB_DIR)) {
            fs.mkdirSync(DB_DIR, { recursive: true });
            console.log(`Database directory created at ${DB_DIR}`);
        }
        if (!fs.existsSync(DB_PATH)) {
            fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }, null, 2), 'utf8');
            console.log(`db.json created at ${DB_PATH}`);
        } else {
            console.log(`db.json already exists at ${DB_PATH}`);
        }
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exit(1); // Exit if database initialization fails
    }
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(path.join(__dirname, 'public', 'media')));


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'anime.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

app.get('/anime.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'anime.html'));
});

app.get('/random', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'random.html'));
});

app.get('/new', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'new.html'));
});

app.get('/new-detail', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'new-detail.html'));
});

app.get('/stream-dwl', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stream-dwl.html'));
});

app.post('/api/signup', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ message: 'Username, email, and password are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { // Basic email validation
        return res.status(400).json({ message: 'Invalid email format' });
    }
     if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    fs.readFile(DB_PATH, 'utf8', async (err, data) => {
        if (err) {
            console.error('Error reading db.json:', err);
            return res.status(500).json({ message: 'Server error during signup (read)' });
        }
        const db = JSON.parse(data);
        const existingUserByUsername = db.users.find(user => user.username === username);
        if (existingUserByUsername) {
            return res.status(409).json({ message: 'Username already exists' });
        }
        const existingUserByEmail = db.users.find(user => user.email === email);
        if (existingUserByEmail) {
            return res.status(409).json({ message: 'Email already registered' });
        }
        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const userId = uuidv4(); // Generate UUID for the user
            db.users.push({ id: userId, username, email, password: hashedPassword });
            fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8', (writeErr) => {
                if (writeErr) {
                    console.error('Error writing to db.json:', writeErr);
                    return res.status(500).json({ message: 'Server error during signup (write)' });
                }
                res.status(201).json({ message: 'User created successfully! Please login.' });
            });
        } catch (hashError) {
            console.error('Error hashing password:', hashError);
            return res.status(500).json({ message: 'Server error during password processing' });
        }
    });
});

app.post('/api/login', (req, res) => {
    const { identifier, password } = req.body; // identifier can be username or email
    if (!identifier || !password) {
        return res.status(400).json({ message: 'Username/Email and password are required' });
    }
    fs.readFile(DB_PATH, 'utf8', async (err, data) => {
        if (err) {
            console.error('Error reading db.json:', err);
            return res.status(500).json({ message: 'Server error during login (read)' });
        }
        const db = JSON.parse(data);
        const user = db.users.find(u => u.username === identifier || u.email === identifier);
        if (!user) {
            return res.status(401).json({ message: 'Invalid username/email or password' });
        }
        try {
            const isMatch = await bcrypt.compare(password, user.password);
            if (isMatch) {
                res.status(200).json({ message: 'Login successful!', redirectTo: '/anime.html' });
            } else {
                res.status(401).json({ message: 'Invalid username/email or password' });
            }
        } catch (compareError) {
            console.error('Error comparing password:', compareError);
            return res.status(500).json({ message: 'Server error during login (compare)' });
        }
    });
});

app.get('/api/search-anime', async (req, res) => {
    const { animename, episode } = req.query;
    if (!animename) {
        return res.status(400).json({ message: 'Anime name is required' });
    }
    const effectiveEpisode = episode || "1"; // Default to episode 1 if not provided
    const externalApiUrl = `https://txtorg-anihx.hf.space/api/episode?anime=${encodeURIComponent(animename)}&ep=${encodeURIComponent(effectiveEpisode)}`;
    console.log(`Attempting to fetch from external API: ${externalApiUrl}`);
    try {
        const apiResponse = await axios.get(externalApiUrl);
        if (typeof apiResponse.data !== 'object' || apiResponse.data === null) {
            console.error('Unexpected response format from external API (not an object):', apiResponse.data);
            return res.status(500).json({ message: 'Received invalid data format from anime API.' });
        }
        // Check if the API returned a specific error message in its 200 OK response
        if (apiResponse.data.detail && typeof apiResponse.data.detail === 'string' && (!apiResponse.data.title || !apiResponse.data.links)) {
            console.warn(`External API (200 OK) reported: ${apiResponse.data.detail} for ${animename} ep ${effectiveEpisode}`);
            return res.status(404).json({ message: apiResponse.data.detail });
        }
        // Ensure essential data (title and at least one link category) is present
        const subLinksExist = apiResponse.data.links && apiResponse.data.links.sub && Object.keys(apiResponse.data.links.sub).length > 0;
        const dubLinksExist = apiResponse.data.links && apiResponse.data.links.dub && Object.keys(apiResponse.data.links.dub).length > 0;

        if (!apiResponse.data.title || !(subLinksExist || dubLinksExist)) {
             console.warn('Unexpected response structure from external API (200 OK, but critical data missing):', apiResponse.data);
             return res.status(404).json({ message: `Anime "${animename}" episode ${effectiveEpisode} not found or no download links available.` });
        }
        res.json(apiResponse.data);
    } catch (error) {
        console.error(`Error in /api/search-anime proxy request for animename: ${animename}, episode: ${effectiveEpisode}:`);
        if (error.response) {
            console.error('External API - Status:', error.response.status);
            console.error('External API - Data:', error.response.data);
            const message = error.response.data?.detail || `Error from external anime API: Status ${error.response.status}`;
            return res.status(error.response.status || 500).json({ message });
        } else if (error.request) {
            console.error('External API - No response received:', error.request);
            return res.status(503).json({ message: 'Service unavailable: No response from the external anime service.' });
        } else {
            console.error('Axios request setup error:', error.message);
            return res.status(500).json({ message: 'Internal server error: Failed to set up anime search request.' });
        }
    }
});

app.get('/api/image-proxy', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) {
        console.log('Image proxy request with no URL');
        return res.status(400).send('Image URL is required');
    }
    console.log(`Image proxy attempting to fetch: ${imageUrl}`);
    try {
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            // It's often better not to send a specific referer unless absolutely necessary
            // headers: { 'Referer': 'https://animeheaven.me/' }
        });
        const contentType = response.headers['content-type'];
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        } else {
            // Fallback if content-type is missing (less common for images)
            if (imageUrl.endsWith('.jpg') || imageUrl.endsWith('.jpeg')) {
                res.setHeader('Content-Type', 'image/jpeg');
            } else if (imageUrl.endsWith('.png')) {
                res.setHeader('Content-Type', 'image/png');
            } else if (imageUrl.endsWith('.gif')) {
                res.setHeader('Content-Type', 'image/gif');
            }
            // Add more as needed or have a default like 'application/octet-stream'
        }
        res.send(response.data);
    } catch (error) {
        console.error(`Error proxying image ${imageUrl}:`);
        if (error.response) {
            console.error('External Image Source - Status:', error.response.status);
            console.error('External Image Source - Data (first 100 chars):', String(error.response.data).substring(0,100));
            return res.status(error.response.status || 500).send('Error fetching image from source via proxy.');
        } else if (error.request) {
            console.error('External Image Source - No response received for:', imageUrl, error.code);
            return res.status(503).send('Service unavailable: No response from image source via proxy.');
        } else {
            console.error('Axios request setup error for image proxy:', error.message);
            return res.status(500).send('Internal server error: Failed to set up image proxy request.');
        }
    }
});

app.get('/api/random-anime', async (req, res) => {
    const scrapeUrl = 'https://animeheaven.me/random.php';
    try {
        console.log(`Attempting to scrape random anime from: ${scrapeUrl}`);
        const response = await axios.get(scrapeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
            maxRedirects: 5 // Allow redirects as random.php often redirects
        });

        // AnimeHeaven's random.php redirects to the actual anime page.
        // The final URL after redirects is what we need to scrape.
        const finalUrl = response.request.res.responseUrl || scrapeUrl; // Get URL after redirects
        console.log(`Scraping random anime, final URL after redirects: ${finalUrl}`);

        // Sometimes, the initial response to random.php is short, and we need to fetch the final URL content again.
        // We can also check if the content looks like a detail page.
        let htmlData = response.data;
        if (response.data.length < 1000 && finalUrl !== scrapeUrl && !response.data.includes('infotitle c')) {
             // If initial data is too short and we were redirected, fetch the final URL's content
             const finalResponse = await axios.get(finalUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
             });
             htmlData = finalResponse.data;
        }

        const $ = cheerio.load(htmlData);
        const englishName = $('div.infotitle.c').text().trim();
        const japaneseName = $('div.infotitlejp.c').text().trim() || 'Not available';
        const summary = $('div.infodes.c').text().trim();
        
        let poster = $('img.posterimg').attr('src');
        let fullPoster = ''; // Default to empty, placeholder handled on frontend
        if (poster) {
            fullPoster = poster.startsWith('http') ? poster : (poster.startsWith('/') ? `https://animeheaven.me${poster}` : `https://animeheaven.me/${poster}`);
        } else {
             // Fallback selector if posterimg is not found
             poster = $('div.ani_detail_img_contain_bottom_left_img_out').find('img').attr('src') || $('meta[property="og:image"]').attr('content');
             if(poster){
                fullPoster = poster.startsWith('http') ? poster : (poster.startsWith('/') ? `https://animeheaven.me${poster}` : `https://animeheaven.me/${poster}`);
             }
        }

        const infoDivs = $('div.infoyear.c div.inline.c2'); // More specific selector
        const episodes = $(infoDivs[0]).text().trim() || 'N/A';
        const year = $(infoDivs[1]).text().trim() || 'N/A';
        const rating = $(infoDivs[2]).text().trim() || 'N/A';

        const tags = [];
        $('div.infotags.c a div.boxitem').each((_, el) => {
            tags.push($(el).text().trim());
        });

        if (!englishName && !summary && !fullPoster) { // Check if essential details are missing
            console.error('Failed to scrape essential anime details from AnimeHeaven.', { finalUrl, htmlLength: htmlData.length });
            return res.status(500).json({ message: 'Failed to scrape anime details. The page structure might have changed or no details were found. Please try again.' });
        }
        console.log(`Scraped random anime: ${englishName}`);
        res.json({
            englishName: englishName || "Title not found",
            japaneseName,
            summary: summary || "Summary not available.",
            poster: fullPoster, // Can be empty if not found, frontend handles placeholder
            episodes,
            year,
            rating,
            tags
        });

    } catch (error) {
        console.error('Error in /api/random-anime endpoint:', error.message);
        if (error.response) {
             console.error('Error response data:', error.response.data ? String(error.response.data).substring(0, 200) + '...' : 'No response data');
             console.error('Error response status:', error.response.status);
        } else {
            console.error(error.stack)
        }
        res.status(500).json({ message: 'Server error while fetching random anime: ' + error.message });
    }
});

app.get('/api/new-anime', async (req, res) => {
    const scrapeUrl = "https://animeheaven.me/new.php";
    try {
        console.log(`Attempting to scrape new anime from: ${scrapeUrl}`);
        const response = await axios.get(scrapeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        const $ = cheerio.load(response.data);
        const animeList = [];

        $('.chart.bc1').each((i, el) => {
            const imagePath = $(el).find('img.coverimg').attr('src');
            const englishName = $(el).find('.charttitle a').text().trim();
            const japaneseName = $(el).find('.charttitlejp').text().trim() || 'Not available';
            const time = $(el).find('.charttimer.c2').text().trim();
            
            // Extract ID and full link for navigation to detail page
            const href = $(el).find('.charttitle a').attr('href'); // e.g. anime.php?9pmqb
            const id = href?.split('?')[1] || 'unknown'; // Extract just the ID part
            const animeLink = `https://animeheaven.me/anime.php?${id}`; // Construct full link

            let imageUrl = 'https://placehold.co/300x170.png'; // Default placeholder
            if (imagePath) {
                if (imagePath.startsWith('http')) {
                    imageUrl = imagePath;
                } else {
                    imageUrl = `https://animeheaven.me${imagePath.startsWith('/') ? '' : '/'}${imagePath}`;
                }
            }

            if (englishName) { // Only add if an English name exists
                 animeList.push({
                    id, // Include the ID
                    link: animeLink, // Include the full link
                    image: imageUrl,
                    englishName,
                    japaneseName,
                    time: time || 'N/A'
                });
            }
        });

        if (animeList.length === 0) {
            console.warn('No new anime found or failed to parse from AnimeHeaven new.php');
            return res.status(404).json({ message: 'No new anime found or page structure might have changed.' });
        }
        console.log(`Successfully scraped ${animeList.length} new anime entries.`);
        res.json(animeList);

    } catch (error) {
        console.error('Error in /api/new-anime endpoint:', error.message);
        if (error.response) {
             console.error('Error response data (new-anime):', error.response.data ? String(error.response.data).substring(0, 200) + '...' : 'No response data');
             console.error('Error response status (new-anime):', error.response.status);
        } else {
            console.error(error.stack);
        }
        res.status(500).json({ message: 'Server error while fetching new anime: ' + error.message });
    }
});

app.get('/api/anime-details', async (req, res) => {
    const animeUrl = req.query.url; // Expecting full URL like https://animeheaven.me/anime.php?ID_HERE
    if (!animeUrl) {
        return res.status(400).json({ message: 'Anime URL is required' });
    }

    try {
        console.log(`Attempting to scrape anime details from: ${animeUrl}`);
        const response = await axios.get(animeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        const $ = cheerio.load(response.data);

        const englishName = $('div.infotitle.c').text().trim();
        const japaneseName = $('div.infotitlejp.c').text().trim() || 'Not available';
        const summary = $('div.infodes.c').text().trim();
        
        let poster = $('img.posterimg').attr('src');
         let fullPoster = 'https://placehold.co/300x450.png'; // Default placeholder for detail view
        if (poster) {
            fullPoster = poster.startsWith('http') ? poster : (poster.startsWith('/') ? `https://animeheaven.me${poster}` : `https://animeheaven.me/${poster}`);
        } else {
             // Fallback selector if posterimg is not found
             poster = $('div.ani_detail_img_contain_bottom_left_img_out').find('img').attr('src') || $('meta[property="og:image"]').attr('content');
             if(poster){
                fullPoster = poster.startsWith('http') ? poster : (poster.startsWith('/') ? `https://animeheaven.me${poster}` : `https://animeheaven.me/${poster}`);
             }
        }

        const infoDivs = $('div.infoyear.c div.inline.c2');
        const episodes = $(infoDivs[0]).text().trim() || 'N/A';
        const year = $(infoDivs[1]).text().trim() || 'N/A';
        const rating = $(infoDivs[2]).text().trim() || 'N/A';

        const tags = [];
        $('div.infotags.c a div.boxitem').each((_, el) => {
            tags.push($(el).text().trim());
        });

        if (!englishName && !summary && !fullPoster.includes('animeheaven.me')) { // If essential details are missing and poster isn't from AH
            console.error('Failed to scrape essential anime details from AnimeHeaven.', { animeUrl });
            return res.status(500).json({ message: 'Failed to scrape anime details. The page structure might have changed or no details were found.' });
        }

        res.json({
            englishName: englishName || "Title not found",
            japaneseName,
            summary: summary || "Summary not available.",
            poster: fullPoster,
            episodes,
            year,
            rating,
            tags: tags.length > 0 ? tags : ["N/A"] // Ensure tags is always an array
        });

    } catch (error) {
        console.error(`Error in /api/anime-details endpoint for URL ${animeUrl}:`, error.message);
        if (error.response) {
             console.error('Error response data:', error.response.data ? String(error.response.data).substring(0, 200) + '...' : 'No response data');
             console.error('Error response status:', error.response.status);
        } else {
            console.error(error.stack);
        }
        res.status(500).json({ message: 'Server error while fetching anime details: ' + error.message });
    }
});

app.get('/api/anime-suggestions', async (req, res) => {
    const now = Date.now();
    if (cachedSuggestions && (now - suggestionsCacheTimestamp < SUGGESTIONS_CACHE_DURATION)) {
        console.log('Serving anime suggestions from cache.');
        return res.json(cachedSuggestions);
    }

    const scrapeUrl = 'https://animeheaven.me/popular.php';
    try {
        console.log(`Attempting to scrape popular anime from: ${scrapeUrl} for suggestions.`);
        const response = await axios.get(scrapeUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        const allPopularAnime = [];

        $('.chart').each((_, el) => { // Iterate over each popular anime chart item
            const imagePath = $(el).find('.chartimg img.coverimg').attr('src'); // Path like 'covers/hunter-x-hunter-2011.jpg'
            let imageUrl = 'https://placehold.co/180x250.png'; // Default placeholder
            if (imagePath) {
                 imageUrl = `https://animeheaven.me/${imagePath.startsWith('/') ? imagePath.substring(1) : imagePath}`;
            }
            
            // Try to get English name first from charttitle, then Japanese from charttitlejp
            const englishNameAnchor = $(el).find('.charttitle a');
            let englishName = englishNameAnchor.text().trim();
            if (!englishName) { // Fallback if <a> tag is not present or empty
                englishName = $(el).find('.charttitle').text().trim();
            }
            englishName = englishName || 'Name not available'; // Ensure a value

            const japaneseName = $(el).find('.charttitlejp').text().trim() || 'N/A'; // Japanese name fallback
            
            const href = $(el).find('.chartimg a').attr('href'); // Path like 'anime.php?hunter-x-hunter-2011'
            let animeLink = '#'; // Default link
            if (href) {
                animeLink = `https://animeheaven.me/${href.startsWith('/') ? href.substring(1) : href}`;
            }

            if (englishName !== 'Name not available' && animeLink !== '#') { // Only add if we have a name and a link
                 allPopularAnime.push({
                    image: imageUrl,
                    englishName: englishName, // Use English name
                    japaneseName: japaneseName, // Keep Japanese name for potential future use or display
                    link: animeLink
                });
            }
        });

        if (allPopularAnime.length === 0) {
            console.warn('No popular anime found or failed to parse from AnimeHeaven popular.php for suggestions.');
            return res.status(404).json({ message: 'Could not fetch popular anime suggestions at this time.' });
        }

        // Shuffle the array and pick the first 4
        const selectedSuggestions = [];
        const shuffled = allPopularAnime.sort(() => 0.5 - Math.random()); // Simple shuffle
        selectedSuggestions.push(...shuffled.slice(0, Math.min(4, shuffled.length))); // Take up to 4
        
        cachedSuggestions = selectedSuggestions;
        suggestionsCacheTimestamp = now;
        console.log(`Successfully scraped and cached ${selectedSuggestions.length} anime suggestions.`);
        res.json(selectedSuggestions);

    } catch (error)
 {
        console.error('Error in /api/anime-suggestions endpoint:', error.message);
        if (error.response) {
             console.error('Error response data (suggestions):', error.response.data ? String(error.response.data).substring(0, 200) + '...' : 'No response data');
             console.error('Error response status (suggestions):', error.response.status);
        } else {
            console.error(error.stack);
        }
        res.status(500).json({ message: 'Server error while fetching popular anime suggestions: ' + error.message });
    }
});

app.get('/api/resolve-download-link', async (req, res) => {
    const paheWinUrl = req.query.url;
    if (!paheWinUrl) {
        return res.status(400).json({ message: 'Pahe.win URL is required' });
    }

    const externalApiUrl = `https://txtorg-anihx.hf.space/resolvex?url=${encodeURIComponent(paheWinUrl)}`;
    console.log(`Attempting to resolve Pahe.win URL: ${externalApiUrl}`);

    try {
        const apiResponse = await axios.get(externalApiUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });

        if (apiResponse.data && (apiResponse.data.kwikLink || apiResponse.data.mp4Link)) {
            console.log(`Resolved links for ${paheWinUrl}: Kwik - ${apiResponse.data.kwikLink}, MP4 - ${apiResponse.data.mp4Link}`);
            res.json({
                kwikLink: apiResponse.data.kwikLink,
                mp4Link: apiResponse.data.mp4Link
            });
        } else {
            console.warn(`Failed to resolve or no links found for ${paheWinUrl}. API Response:`, apiResponse.data);
            // It's possible the resolver returns 200 OK but with an error message or no links
            res.status(404).json({ message: 'Could not resolve download links or no links found.' });
        }
    } catch (error) {
        console.error(`Error resolving pahe.win URL ${paheWinUrl}:`);
        if (error.response) {
            console.error('External Resolver API - Status:', error.response.status);
            console.error('External Resolver API - Data:', error.response.data);
            const message = error.response.data?.message || `Error from external resolver API: Status ${error.response.status}`;
            return res.status(error.response.status || 500).json({ message });
        } else if (error.request) {
            console.error('External Resolver API - No response received:', error.request);
            return res.status(503).json({ message: 'Service unavailable: No response from the external link resolver service.' });
        } else {
            console.error('Axios request setup error for resolver:', error.message);
            return res.status(500).json({ message: 'Internal server error: Failed to set up link resolver request.' });
        }
    }
});


// Catch-all for 404 errors - must be after all other routes
app.use((req, res, next) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// General error handler - must be the last app.use()
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err); // Log the full error for server-side debugging
    if (req.originalUrl.startsWith('/api/')) { // Check if the request was for an API endpoint
        res.status(500).json({ message: 'Internal Server Error. Please try again later.' });
    } else {
        // For non-API requests, you might want to send a generic HTML error page
        // For now, sending simple text/HTML
        res.status(500).send('<h1>Internal Server Error</h1><p>Sorry, something went wrong. Please try again later.</p>');
    }
});

initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Express server is listening on http://localhost:${PORT}`);
        // console.log('Serving public/anime.html at /');
        // console.log('Serving public/login.html at /login');
        // console.log('Serving public/signup.html at /signup');
        // console.log('Serving public/random.html at /random');
        // console.log('Serving public/new.html at /new');
        // console.log('Serving public/new-detail.html at /new-detail');
        // console.log('API /api/signup for user registration');
        // console.log('API /api/login for user login');
        // console.log('API /api/search-anime for anime search');
        // console.log('API /api/image-proxy for serving images');
        // console.log('API /api/random-anime for random anime suggestions');
        // console.log('API /api/new-anime for new anime releases');
        // console.log('API /api/anime-details for specific anime details');
        // console.log('API /api/anime-suggestions for popular anime suggestions');
        // console.log('API /api/resolve-download-link for resolving pahe.win links');
        // console.log('Serving 404.html for undefined routes');
    });
}).catch(err => {
    console.error("Failed to initialize database and start server:", err);
});

    
