const mysql = require( 'mysql' );

module.exports = ( sql, args ) => {
    return new Promise( ( resolve, reject ) => {
        mysql.createConnection({
            host: "localhost",
            user: "root",
            password: "",
            database: "mokka"
        }).query( sql, args, ( err, rows ) => {
            if ( err )
                return reject( err );
            resolve( rows );
        } );
    } );
};