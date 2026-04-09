const mysql = require("mysql2");

const connectDB = async () => {
    const pool = mysql.createPool({
        host: process.env.HOST,
        user: process.env.USER,
        password: process.env.PASSWORD,
        database: process.env.DATABASE,
    });
      

  pool.getConnection((err, connection) => {
    if (err) {
      console.log({ error: err.message });
    }

    console.log("Connected to MySQL database");
    connection.release();
  });
};

module.exports = connectDB;