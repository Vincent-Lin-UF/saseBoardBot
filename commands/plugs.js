const { SlashCommandBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const moment = require('moment-timezone');

const db = new sqlite3.Database(path.join(__dirname, '../events.db'), (err) => {
    if (err) {
        console.error('Error opening database', err);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_name TEXT,
            start_date TEXT,
            end_date TEXT,
            dates_list TEXT
        )`, (err) => {
            if (err) {
                console.error('Error creating events table:', err);
            } else {
                db.run(`ALTER TABLE events ADD COLUMN thread_id TEXT`, (err) => {
                    if (err) {
                        console.log('thread_id column might already exist:', err.message);
                    } else {
                        console.log('Added thread_id column to events table');
                    }
                });
            }
        });
    }
});

// Schedule Mentions
function scheduleMentions(client, threadId, formattedDatesList, eventName) {
    formattedDatesList.forEach(entry => {
        const [month, day] = entry.date.split('/');
        const year = new Date().getFullYear(); 
        const mentionDate = moment.tz(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} 14:35`, "America/New_York");
        
        if (mentionDate.isAfter(moment())) { 
            const job = schedule.scheduleJob(mentionDate.toDate(), async function() {
                try {
                    const channel = await client.channels.fetch(threadId);
                    await channel.send(`${entry.date} - ${entry.mentions.join(', ')}`);
                    console.log(`Sent scheduled mention for ${eventName} on ${entry.date}`);
                } catch (error) {
                    console.error(`Failed to send scheduled mention for ${eventName} on ${entry.date}:`, error);
                }
            });
            console.log(`Scheduled mention for ${eventName} on ${entry.date} at ${mentionDate.format()}`);
        }
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('plug')
        .setDescription('Collects event details and schedules mentions for 2:20 PM EST each day.')
        .addStringOption(option => 
            option.setName('event_name')
                .setDescription('Name of the event')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('start_date')
                .setDescription('Start date of the event (MM/DD/YYYY or M/D/YY)')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('end_date')
                .setDescription('End date of the event (MM/DD/YYYY or M/D/YY)')
                .setRequired(true)),
    async execute(interaction, client) {
        const eventName = interaction.options.getString('event_name');
        const startDate = interaction.options.getString('start_date');
        const endDate = interaction.options.getString('end_date');

        const dateRegex = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{2}|\d{4})$/;

        if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
            return interaction.reply({ content: 'Invalid date format. Please use MM/DD/YYYY or M/D/YY.', ephemeral: true });
        }

        const parseDate = (dateStr) => {
            const parts = dateStr.split('/');
            const month = parseInt(parts[0], 10);
            const day = parseInt(parts[1], 10);
            let year = parseInt(parts[2], 10);
            if (year < 100) {
                year += (year < 50 ? 2000 : 1900); 
            }
            return new Date(year, month - 1, day);
        };

        const formatDate = (date) => {
            const month = date.getMonth() + 1;
            const day = date.getDate();
            return `${month}/${day}`;
        };

        const start = parseDate(startDate);
        const end = parseDate(endDate);

        if (isNaN(start) || isNaN(end)) {
            return interaction.reply({ content: 'Invalid date. Please enter a valid date.', ephemeral: true });
        }

        if (end < start) {
            return interaction.reply({ content: 'End date must be after start date.', ephemeral: true });
        }

        // Read board.json for discord ID's
        const boardFilePath = path.join(__dirname, '../board.json');
        let board;
        try {
            board = JSON.parse(fs.readFileSync(boardFilePath, 'utf-8'));
        } catch (error) {
            console.error('Error reading board.json:', error);
            return interaction.reply({ content: 'An error occurred while reading the board list.', ephemeral: true });
        }

        // Fetch overlapping events
        db.all(`SELECT * FROM events WHERE 
            (start_date <= ? AND end_date >= ?) OR
            (start_date <= ? AND end_date >= ?) OR
            (start_date >= ? AND end_date <= ?)`, 
            [endDate, startDate, endDate, endDate, startDate, endDate], 
            async (err, rows) => {
                if (err) {
                    console.error('Error fetching overlapping events:', err);
                    return interaction.reply({ content: 'An error occurred while checking for overlapping events.', ephemeral: true });
                }

                // New event schedule
                const datesList = [];
                const currentDate = new Date(start);
                while (currentDate <= end) {
                    datesList.push(formatDate(currentDate));
                    currentDate.setDate(currentDate.getDate() + 1);
                }

                // Map of existing schedule assignment
                const existingAssignments = new Map();
                rows.forEach(row => {
                    const dates = JSON.parse(row.dates_list);
                    dates.forEach(date => {
                        if (!existingAssignments.has(date.date)) {
                            existingAssignments.set(date.date, new Set());
                        }
                        date.mentions.forEach(mention => {
                            const id = mention.match(/<@(\d+)>/)[1];
                            existingAssignments.get(date.date).add(id);
                        });
                    });
                });

                const shuffledBoard = board.sort(() => 0.5 - Math.random());

                // init assignments
                const assignments = {};
                datesList.forEach(date => {
                    assignments[date] = [];
                });

                // min conflicts
                shuffledBoard.forEach(person => {
                    let assignedDate = datesList.find(date => 
                        !existingAssignments.has(date) || !existingAssignments.get(date).has(person.id)
                    );

                    // if conflict free
                    if (!assignedDate) {
                        assignedDate = datesList.reduce((a, b) => 
                            assignments[a].length <= assignments[b].length ? a : b
                        );
                    }

                    assignments[assignedDate].push(person);
                });

                // rebalance
                let maxAssigned = Math.max(...Object.values(assignments).map(a => a.length));
                let minAssigned = Math.min(...Object.values(assignments).map(a => a.length));

                while (maxAssigned - minAssigned > 1) {
                    const dateWithMost = Object.keys(assignments).find(date => assignments[date].length === maxAssigned);
                    const dateWithLeast = Object.keys(assignments).find(date => assignments[date].length === minAssigned);

                    const personToMove = assignments[dateWithMost].pop();
                    assignments[dateWithLeast].push(personToMove);

                    maxAssigned = Math.max(...Object.values(assignments).map(a => a.length));
                    minAssigned = Math.min(...Object.values(assignments).map(a => a.length));
                }

                const formattedDatesList = datesList.map(date => ({
                    date,
                    names: assignments[date].map(person => person.name),
                    mentions: assignments[date].map(person => `<@${person.id}>`)
                }));

                const message = await interaction.reply({ content: `# ${eventName}\n\nPreparing event details...`, fetchReply: true });
                const thread = await message.startThread({
                    name: `${eventName}`,
                    autoArchiveDuration: 60,
                    reason: 'Event thread'
                });

                // database storing
                db.run(`INSERT INTO events (event_name, start_date, end_date, dates_list, thread_id) VALUES (?, ?, ?, ?, ?)`,
                    [eventName, startDate, endDate, JSON.stringify(formattedDatesList), thread.id],
                    async function(err) {
                        if (err) {
                            console.error('Error inserting event:', err);
                            return interaction.followUp({ content: 'An error occurred while saving the event.', ephemeral: true });
                        }
                        
                        // fetch event index
                        db.all(`SELECT id FROM events ORDER BY id`, [], async (err, rows) => {
                            if (err) {
                                console.error('Error fetching events:', err);
                                return interaction.followUp({ content: 'An error occurred while retrieving the event list.', ephemeral: true });
                            }

                            const eventIndex = rows.findIndex(row => row.id === this.lastID) + 1;

                            const formattedDates = formattedDatesList.map(entry => `${entry.date} - ${entry.names.join(', ')}`).join('\n');
                            await message.edit({ content: `# ${eventName}\n\nEvent stored with Index ${eventIndex}.\n\n${formattedDates}\n\nMentions will be sent daily at 2:20 PM EST.` });
                            scheduleMentions(client, thread.id, formattedDatesList, eventName);
                        });
                    }
                );
            }
        );
    },
};

// rescheudle events when bot restarts  
function rescheduleAllEvents(client) {
    db.all(`SELECT * FROM events`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching events for rescheduling:', err);
            return;
        }
        rows.forEach(row => {
            const formattedDatesList = JSON.parse(row.dates_list);
            scheduleMentions(client, row.thread_id, formattedDatesList, row.event_name);
        });
    });
}

// export the rescheduleAllEvents function so it can be called when the bot starts
module.exports.rescheduleAllEvents = rescheduleAllEvents;