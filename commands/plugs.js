const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('plug')
        .setDescription('Collects event details.')
        .addStringOption(option => 
            option.setName('event_name')
                .setDescription('Name of the event')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('start_date')
                .setDescription('Start date of the event (MM/DD/YYYY and/or M/D/YY)')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('end_date')
                .setDescription('End date of the event (MM/DD/YYYY and/or M/D/YY)')
                .setRequired(true)),
    async execute(interaction) {
        const eventName = interaction.options.getString('event_name');
        const startDate = interaction.options.getString('start_date');
        const endDate = interaction.options.getString('end_date');

        const dateRegex = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{2}|\d{4})$/;

        if (!dateRegex.test(startDate)) {
            return interaction.reply({ content: 'Invalid start date format. Please use MM/DD/YYYY or M/D/YY.', ephemeral: true });
        }

        if (!dateRegex.test(endDate)) {
            return interaction.reply({ content: 'Invalid end date format. Please use MM/DD/YYYY or M/D/YY.', ephemeral: true });
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

        // Read 
        const boardFilePath = path.join(__dirname, '../board.json');
        let board;
        try {
            board = JSON.parse(fs.readFileSync(boardFilePath, 'utf-8'));
        } catch (error) {
            console.error('Error reading board.json:', error);
            return interaction.reply({ content: 'An error occurred while reading the board list.', ephemeral: true });
        }

        // Shuffle the board array
        const shuffledBoard = board.sort(() => 0.5 - Math.random());

        let currentDate = new Date(start);
        const datesList = [];
        let dateIndex = 0;

        // Count the number of days in the date range
        const numDays = (end - start) / (1000 * 60 * 60 * 24) + 1;

        // Calculate the number of people per day
        const peoplePerDay = Math.floor(shuffledBoard.length / numDays);
        const extraPeople = shuffledBoard.length % numDays;

        for (let i = 0; i < numDays; i++) {
            const day = formatDate(currentDate);
            const numPeopleToday = peoplePerDay + (i < extraPeople ? 1 : 0);
            const peopleToday = shuffledBoard.splice(0, numPeopleToday);
            datesList.push({
                date: day,
                names: peopleToday.map(person => person.name),
                mentions: peopleToday.map(person => `<@${person.id}>`)
            });
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Format the non-thread message with actual names
        const formattedDates = datesList.map(entry => `${entry.date} - ${entry.names.join(', ')}`).join('\n');

        // Send the initial message displaying all dates and names
        const message = await interaction.reply({ content: `# ${eventName}\n\n${formattedDates}`, fetchReply: true });

        // Create a thread from the initial message
        const thread = await message.startThread({
            name: `${eventName}`,
            autoArchiveDuration: 60,
            reason: 'Event thread'
        });

        // Function to wait for a specified time
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // Send each date message in the thread with user mentions with a 2-second delay
        for (const entry of datesList) {
            await thread.send(`${entry.date} - ${entry.mentions.join(', ')}`);
            await wait(2000); // Wait for 2 seconds before sending the next message
        }
    },
};
