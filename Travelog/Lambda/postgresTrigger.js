import pg from "pg";

const client = new pg.Client();
let isConnected = false;

async function connectClient() {
  if (!isConnected) {
    await client.connect();
    isConnected = true;
  }
}

export const handler = async (event) => {
  console.log("Event", event);
  try {
    await connectClient();

    switch (event.command) {
      case "insertOrUpdatePovsToPostgre":
        return await insert_or_update_povs_to_postgre(event);

      case "getNearestPovs":
        return await get_nearest_povs(event);

      case "deleteFromPostgre":
        return await delete_from_postgre(event);

      default:
        return "invalid";
    }
  }
  catch (error) {
    console.error('Error executing handler:', error);
    throw error;
  }
};

async function insert_or_update_povs_to_postgre(event) {
  try {
    console.log('event ', event);
    console.log('am here');

    const {
      pov_id,
      created_by,
      creator_name,
      creator_user_type,
      pov_created_on,
      pov_description,
      pov_name,
      pov_status,
      pov_latitude,
      pov_longitude
    } = event;

    let post_url = event.post_url !== undefined ? event.post_url : [];
    let query_text = "select * from tl_insert_users_pov($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)";
    const { rows } = await client.query(query_text, [pov_id, created_by, creator_name, creator_user_type, post_url, pov_created_on, pov_description, pov_name, pov_status, pov_latitude, pov_longitude]);

    if (rows[0].status_value === 1) {
      console.log(rows[0]);
      return rows[0];
    }
    else {
      console.log("POV Not Inserted Or Updated!");
      return "ERROR_OCCURED";
    }
  }
  catch (err) {
    console.error('Error executing insert_or_update_povs_to_postgre:', err);
    throw err;
  }
}

async function get_nearest_povs(event) {
  try {
    const pov_latitude = event.user_latitude;
    const pov_longitude = event.user_longitude;
    const queryText = "SELECT * FROM tl_get_nearest_povs($1, $2, $3)";
    const res = await client.query(queryText, [pov_latitude, pov_longitude, 100]);

    const cleanResponse = res.rows.map(row => ({
      pov_id: row.pov_id,
      created_by: row.created_by,
      creator_name: row.creator_name,
      creator_user_type: row.creator_user_type,
      pov_created_on: row.pov_created_on,
      pov_description: row.pov_description,
      pov_name: row.pov_name,
      pov_latitude: row.pov_latitude,
      pov_longitude: row.pov_longitude
    }));
    console.log(cleanResponse);
    return { Status: 200, cleanResponse };
  }
  catch (err) {
    console.error('Error executing get_nearest_povs:', err);
    throw err;
  }
}

async function delete_from_postgre(event) {
  console.log('event ', event);
  try {
    const { pov_id } = event;
    let query_text = "SELECT * FROM tl_delete_users_pov($1)";
    const { rows } = await client.query(query_text, [pov_id]);

    if (rows[0].status_value === 1) {
      console.log(rows[0]);
      return rows[0];
    }
    else {
      console.log("POV Not Deleted!");
      return "ERROR_OCCURED";
    }
  }
  catch (err) {
    console.error('Error executing delete_from_postgre:', err);
    throw err;
  }
}
