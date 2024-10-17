const { SlashCommandBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '../events.db'));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pluglist')
        .setDescription('Lists all current plugs'),
    async execute(interaction) {
        db.all(`SELECT id, event_name, start_date, end_date FROM events ORDER BY id`, [], (err, rows) => {
            if (err) {
                console.error('Error fetching plugs:', err);
                return interaction.reply('An error occurred while fetching the plug list.');
            }

            if (rows.length === 0) {
                return interaction.reply('There are no plugs currently stored.');
            }

            const plugList = rows.map((row, index) => 
                `${index + 1}. ${row.event_name} (${row.start_date} to ${row.end_date})`
            ).join('\n');

            interaction.reply(`Current plugs:\n\n${plugList}`);
        });
    },
};