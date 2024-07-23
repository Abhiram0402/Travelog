/** @format */

'use strict';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import pkg from '@aws-sdk/client-cognito-identity-provider';
const { CognitoIdentityProviderClient, SignUpCommand, AdminGetUserCommand, RespondToAuthChallengeCommand, AdminInitiateAuthCommand, AdminCreateUserCommand, AdminDeleteUserCommand, AdminSetUserPasswordCommand } = pkg;
import { v4 as uuidv4 } from 'uuid';
import { BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import * as ddb from '@aws-sdk/lib-dynamodb';
import axios from 'axios';
import fs from 'fs/promises';
import XLSX from 'xlsx';
// import pg from 'pg';
// import { Client } from 'pg';
// import AWS from 'aws-sdk';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/* dynamo functions */
/*******************************************************************************************************/
export const insert_into_dynamo = async (params) => {
    try {
        await new DynamoDBClient().send(new ddb.PutCommand(JSON.parse(JSON.stringify(params))));
        return 'SUCCESS';
    }
    catch (err) {
        console.log(params, err);
        return 'ERROR';
    }
};

export const query_dynamo = async (params) => {
    try {
        return await new DynamoDBClient().send(new ddb.QueryCommand(params));
    }
    catch (err) {
        console.log("**********QUERY_DYNAMO_ERROR", err);
        return 'ERROR';
    }
};

export const scan_dynamo = async (params) => {
    try {
        return await new DynamoDBClient().send(new ScanCommand(params));
    }
    catch (err) {
        console.log("**********SCAN_DYNAMO_ERROR", err);
        return 'ERROR';
    }
};

export const update_dynamo = async (params) => {
    try {
        await new DynamoDBClient().send(new ddb.UpdateCommand(params));
        return 'SUCCESS';
    }
    catch (err) {
        console.log(params, err);
        return 'ERROR';
    }
};

export const delete_dynamo = async (params) => {
    try {
        await new DynamoDBClient().send(new ddb.DeleteCommand(params));
        return 'SUCCESS';
    }
    catch (err) {
        console.log(params, err);
        return 'ERROR';
    }
};

/* master query all */

export const get_query_all_data = async (event) => {
    let response = { Count: 0, Items: [] };
    const query_data = async (event) => {
        const results = await new DynamoDBClient().send(new ddb.QueryCommand(event));
        if (results.LastEvaluatedKey) {
            response.Count += results.Count;
            response.Items = response.Items.concat(results.Items);
            event.ExclusiveStartKey = results.LastEvaluatedKey;
            return await query_data(event);
        }
        else {
            response.Count += results.Count;
            response.Items = response.Items.concat(results.Items);
            return response;
        }
    };
    return await query_data(event);
};

/* lambda invoke functions */

export const invokeLambda = async (funcName, payload, event_type) => {
    const command = new InvokeCommand({
        FunctionName: funcName,
        Payload: payload,
        InvocationType: event_type, //'RequestResponse', // "Event"
    });
    await new LambdaClient().send(command);
    return 'SUCCESS';
};


/* check empty field functions */

export const check_empty_fields = (event) => {
    let checkEmptyFields = true;
    for (const field in event) {
        if (typeof event[field] == 'string') {
            if (event[field].trim().length == 0) {
                delete event[field];
            }
            else {
                event[field] = event[field].trim();
            }
        }
    }
    return checkEmptyFields;
};

export const get_batch_data = async (details, tablename, is_true, ProjectionExpression) => {
    let batches = [];
    let team_ids = details;
    while (team_ids.length) {
        batches.push(team_ids.splice(0, 25));
    }
    let all_resposne = [];
    for (let i = 0; i < batches.length; i++) {
        let params = {
            RequestItems: {
                [tablename]: {
                    Keys: batches[i],
                },
            },
        };
        if (is_true) {
            params.RequestItems[tablename].ProjectionExpression = ProjectionExpression;
        }
        const results = await new DynamoDBClient().send(new ddb.BatchGetCommand(params));
        all_resposne.push(results.Responses[tablename]);
    }
    return all_resposne.flat(Infinity);
};


/******************************************************************************************************************************************************************************************************************/

/***get_agent***/
export const get_agent = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserExist = {
            TableName: "tl_agent",
            IndexName: "agent_email-agent_status-index",
            KeyConditionExpression: "agent_email = :agent_email and agent_status = :agent_status",
            ExpressionAttributeValues: {
                ":agent_email": event.agent_email,
                ":agent_status": "ACTIVE"
            }
        };
        let UserDetails = await query_dynamo(checkUserExist);
        if (UserDetails.Count > 0) {
            return { Status: "SUCCESS", Data: UserDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "User Not Found!!!" };
        }
    }
};

/***agent_travelogue_creation***/
// export const agent_travelogue_creation = async (event) => {
//     if (await check_empty_fields(event)) {
//         let checkUserExist = {
//             TableName: "tl_agent",
//             IndexName: "agent_phone_number-agent_status-index",
//             KeyConditionExpression: "agent_phone_number = :agent_phone_number and agent_status = :agent_status",
//             ExpressionAttributeValues: {
//                 ":agent_phone_number": event.agent_phone_number,
//                 ":agent_status": "ACTIVE"
//             }
//         };
//         let UserDetails = await query_dynamo(checkUserExist);
//         if (UserDetails.Count > 0) {
//             let createtravelogue = {
//                 TableName: "tl_draft_travelogues",
//                 Item: {
//                     travelogue_id: uuidv4(),
//                     user_id: UserDetails.Items[0].agent_id,
//                     agent_email: UserDetails.Items[0].agent_email,
//                     phone_number: event.agent_phone_number,
//                     user_status: 'ACTIVE',
//                     travelogue_image: event.travelogue_image || null,
//                     travelogue_name: event.travelogue_name,
//                     travelogue_description: event.travelogue_description,
//                     travelogue_created_on: Math.floor(new Date().getTime() / 1000),
//                     travelogue_created_by: UserDetails.Items[0].travel_agency_name,
//                     travelogue_status: 'ACTIVE',
//                     travelogue_availability: UserDetails.Items[0].agent_phone_number == "9999999999" ? "TRAVELOGUE_DEFAULT" : "DRAFT",
//                     pov_count: 0,
//                     post_count: 0,
//                     travelogue_Departure_state: event.travelogue_Departure_state,
//                     travelogue_Departure_country: event.travelogue_Departure_country,
//                 }
//             };
//             console.log('createtravelogue', UserDetails.Items[0].phone_number);
//             let createResponse = await insert_into_dynamo(createtravelogue);
//             if (createResponse == "SUCCESS") {
//                 let mappinguser = {
//                     TableName: "tl_users_access",
//                     Item: {
//                         mapping_id: uuidv4(),
//                         travelogue_id: createtravelogue.Item.travelogue_id,
//                         user_id: UserDetails.Items[0].agent_id,
//                         user_name: UserDetails.Items[0].agent_name,
//                         phone_number: UserDetails.Items[0].agent_phone_number,
//                         account_type: "AGENT",
//                         user_status: UserDetails.Items[0].agent_status,
//                         travelogue_status: "ACTIVE"
//                     }
//                 };
//                 await insert_into_dynamo(mappinguser);
//                 return { Status: "SUCCESS", Message: "Travelog Created Successfully !!!" };
//             }
//             else {
//                 return { Status: "ERROR", Message: "Failed to create Travelog" };
//             }
//         }
//         else {
//             return { Status: "ERROR", Message: "Agent Doesn't Exist!!" };
//         }
//     }
//     else {
//         return { Status: "ERROR", Message: "Empty Field Occured!!" };
//     }
// };



export const agent_travelogue_creation = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserExist = {
            TableName: "tl_agent",
            IndexName: "agent_phone_number-agent_status-index",
            KeyConditionExpression: "agent_phone_number = :agent_phone_number and agent_status = :agent_status",
            ExpressionAttributeValues: {
                ":agent_phone_number": event.agent_phone_number,
                ":agent_status": "ACTIVE"
            }
        };
        let UserDetails = await query_dynamo(checkUserExist);
        if (UserDetails.Count > 0) {
            let createtravelogue = {
                TableName: "tl_draft_travelogues",
                Item: {
                    travelogue_id: uuidv4(),
                    user_id: UserDetails.Items[0].agent_id,
                    agent_email: UserDetails.Items[0].agent_email,
                    phone_number: event.agent_phone_number,
                    user_status: 'ACTIVE',
                    travelogue_image: event.travelogue_image || null,
                    travelogue_name: event.travelogue_name,
                    travelogue_description: event.travelogue_description,
                    travelogue_created_on: Math.floor(new Date().getTime() / 1000),
                    travelogue_created_by: UserDetails.Items[0].travel_agency_name,
                    travelogue_status: 'ACTIVE',
                    travelogue_availability: UserDetails.Items[0].agent_phone_number == "9999999999" ? "TRAVELOGUE_DEFAULT" : "DRAFT",
                    pov_count: 0,
                    post_count: 0,
                    travelogue_Departure_state: event.travelogue_Departure_state,
                    travelogue_Departure_country: event.travelogue_Departure_country,
                    price: event.price,
                    inclusions: event.inclusion,
                    exclusions: event.exclusions
                    
                }
            };
            console.log('createtravelogue', UserDetails.Items[0].phone_number);
            let createResponse = await insert_into_dynamo(createtravelogue);
            if (createResponse == "SUCCESS") {
                let mappinguser = {
                    TableName: "tl_users_access",
                    Item: {
                        mapping_id: uuidv4(),
                        travelogue_id: createtravelogue.Item.travelogue_id,
                        user_id: UserDetails.Items[0].agent_id,
                        user_name: UserDetails.Items[0].agent_name,
                        phone_number: UserDetails.Items[0].agent_phone_number,
                        account_type: "AGENT",
                        user_status: UserDetails.Items[0].agent_status,
                        travelogue_status: "ACTIVE"
                    }
                };
                await insert_into_dynamo(mappinguser);
                return { Status: "SUCCESS", Message: "Travelog Created Successfully !!!" };
            }
            else {
                return { Status: "ERROR", Message: "Failed to create Travelog" };
            }
        }
        else {
            return { Status: "ERROR", Message: "Agent Doesn't Exist!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured!!" };
    }
};





/***publish_travelogue***/
export const publish_travelogue = async (event) => {
    if (await check_empty_fields(event)) {
        let checkpoststatus = {
            TableName: "tl_draft_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":phone_number": event.phone_number
            },
            FilterExpression: "phone_number = :phone_number"
        };
        let statusofpost = await query_dynamo(checkpoststatus);
        if (statusofpost.Count > 0) {
            let updateStatus = {
                TableName: "tl_draft_travelogues",
                Key: {
                    travelogue_id: statusofpost.Items[0].travelogue_id
                },
                UpdateExpression: 'SET travelogue_availability = :travelogue_availability , Approval_status = :Approval_status',
                ExpressionAttributeValues: {
                    ':travelogue_availability': "PENDING_APPROVAL",
                    ":Approval_status": "PENDING_APPROVAL"
                }
            };
            await update_dynamo(updateStatus);
            return { Status: "SUCCESS", Message: "Travelogue sent for Approval!" };
        }
        else {
            return { Status: "ERROR", Message: "Failed to publish" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};

/***list_my_draft_travelogues***/
export const list_my_draft_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_draft_travelogues",
            IndexName: "travelogue_availability-travelogue_status-index",
            KeyConditionExpression: " travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_availability": event.phone_number === "9999999999" ? "TRAVELOGUE_DEFAULT" : "DRAFT",
                ":travelogue_status": "ACTIVE",
                ":phone_number": event.phone_number
            },
            FilterExpression: "phone_number = :phone_number"
        };
        let publicDetails = await query_dynamo(getpublicDetails);
        if (publicDetails.Count > 0) {
            return { Status: "SUCCESS", Data: publicDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "my travelogs not found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***list_pending_approval_travelogues***/
export const list_pending_approval_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_draft_travelogues",
            IndexName: "travelogue_availability-travelogue_status-index",
            KeyConditionExpression: " travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_availability": "PENDING_APPROVAL",
                ":travelogue_status": "ACTIVE",
                ":phone_number": event.phone_number
            },
            FilterExpression: "phone_number = :phone_number"
        };
        let publicDetails = await query_dynamo(getpublicDetails);
        if (publicDetails.Count > 0) {
            return { Status: "SUCCESS", Data: publicDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "pending approval travelogs Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***list_rejected_travelogues***/
export const list_rejected_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_draft_travelogues",
            IndexName: "travelogue_availability-travelogue_status-index",
            KeyConditionExpression: " travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_availability": "REJECTED",
                ":travelogue_status": "ACTIVE",
                ":phone_number": event.phone_number
            },
            FilterExpression: "phone_number = :phone_number"
        };
        let publicDetails = await query_dynamo(getpublicDetails);
        if (publicDetails.Count > 0) {
            return { Status: "SUCCESS", Data: publicDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "rejected travelogs Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***delete_travelogue_status***/
export const delete_travelogue_status = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserExist = {
            TableName: "tl_users_access",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE",
                ":travelogue_id": event.travelogue_id,
                ":account_type": "AGENT"
            },
            FilterExpression: "travelogue_id = :travelogue_id and account_type = :account_type"
        };
        let UserDetails = await query_dynamo(checkUserExist);
        if (UserDetails.Count > 0) {
            let checkpoststatus = {
                TableName: "tl_draft_travelogues",
                KeyConditionExpression: "travelogue_id = :travelogue_id",
                FilterExpression: "travelogue_status = :travelogue_status",
                ExpressionAttributeValues: {
                    ":travelogue_id": UserDetails.Items[0].travelogue_id,
                    ":travelogue_status": "ACTIVE"
                }
            };
            let statusofpost = await query_dynamo(checkpoststatus);
            if (statusofpost.Count > 0) {
                update_dynamo({
                    TableName: "tl_draft_travelogues",
                    Key: {
                        travelogue_id: statusofpost.Items[0].travelogue_id
                    },
                    UpdateExpression: 'SET travelogue_status = :travelogue_status , travelogue_availability = :travelogue_availability, Approval_status = :Approval_status',
                    ExpressionAttributeValues: {
                        ':travelogue_status': "DEACTIVATED",
                        ":travelogue_availability": "DEACTIVATED",
                        ":Approval_status": "DEACTIVATED"
                    }
                });
                let updatestatus = {
                    TableName: "tl_travelogues",
                    Key: {
                        travelogue_id: statusofpost.Items[0].travelogue_id
                    },
                    UpdateExpression: 'SET travelogue_status = :travelogue_status , travelogue_availability = :travelogue_availability , Approval_status = :Approval_status',
                    ExpressionAttributeValues: {
                        ':travelogue_status': "DEACTIVATED",
                        ":travelogue_availability": "DEACTIVATED",
                        ":Approval_status": "DEACTIVATED"
                    }
                };
                let updateEndDate = {
                    TableName: "tl_travelogues",
                    Key: {
                        travelogue_id: statusofpost.Items[0].travelogue_id
                    },
                    UpdateExpression: 'SET travelogue_end_date = :travelogue_end_date',
                    ExpressionAttributeValues: {
                        ':travelogue_end_date': Math.floor(new Date().getTime() / 1000)
                    }
                };
                let updateuseraccess = {
                    TableName: "tl_users_access",
                    Key: {
                        mapping_id: UserDetails.Items[0].mapping_id
                    },
                    UpdateExpression: 'SET travelogue_status = :travelogue_status',
                    ExpressionAttributeValues: {
                        ':travelogue_status': "DEACTIVATED"
                    }
                };
                try {
                    await update_dynamo(updatestatus);
                    await update_dynamo(updateEndDate);
                    await update_dynamo(updateuseraccess);
                    return { Status: "SUCCESS", Message: "Travelog Deleted Successfully!!!" };
                }
                catch (error) {
                    return { Status: "ERROR", Message: "Failed to update Travelog status: " };
                }
            }
            else {
                return { Status: "ERROR", Message: "Travelog has been Closed or Terminated" };
            }
        }
        else {
            return { Status: "ERROR", Message: "User does not exist" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***update_travelogue_details***/
export const update_travelogue_details = async (event) => {
    if (await check_empty_fields(event)) {
        let checkpoststatus = {
            TableName: "tl_draft_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id
            }
        };
        let statusofpost = await query_dynamo(checkpoststatus);
        if (statusofpost.Count > 0) {
            update_dynamo({
                TableName: "tl_travelogues",
                Key: {
                    travelogue_id: statusofpost.Items[0].travelogue_id
                },
                UpdateExpression: 'SET travelogue_name = :travelogue_name, travelogue_description = :travelogue_description , travelogue_image = :travelogue_image',
                ExpressionAttributeValues: {
                    ':travelogue_name': event.travelogue_name || "",
                    ':travelogue_description': event.travelogue_description || "",
                    ":travelogue_image": event.travelogue_image || ""
                }
            });
            let updatedetails = {
                TableName: "tl_draft_travelogues",
                Key: {
                    travelogue_id: statusofpost.Items[0].travelogue_id
                },
                UpdateExpression: 'SET travelogue_name = :travelogue_name, travelogue_description = :travelogue_description , travelogue_image = :travelogue_image',
                ExpressionAttributeValues: {
                    ':travelogue_name': event.travelogue_name || "",
                    ':travelogue_description': event.travelogue_description || "",
                    ":travelogue_image": event.travelogue_image || ""
                }
            };
            try {
                await update_dynamo(updatedetails);
                return { Status: "SUCCESS", Message: "Travelog Details Updated Successfully!!!" };
            }
            catch (error) {
                return { Status: "ERROR", Message: "Failed to update Travelog details" };
            }
        }
        else {
            return { Status: "ERROR", Message: "Travelog not found" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***pov_creation***/
export const pov_creation = async (event) => {
    if (await check_empty_fields(event)) {
        let checkaccounttype = {
            TableName: "tl_users_access",
            IndexName: "travelogue_id-phone_number-index",
            KeyConditionExpression: "travelogue_id = :travelogue_id and phone_number = :phone_number",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":phone_number": event.phone_number
            },
        };
        let accounttype = await query_dynamo(checkaccounttype);
        if (accounttype.Count > 0) {
            let checkpoststatus = {
                TableName: "tl_draft_travelogues",
                KeyConditionExpression: "travelogue_id = :travelogue_id",
                ExpressionAttributeValues: {
                    ":travelogue_id": accounttype.Items[0].travelogue_id,
                    ":travelogue_status": "ACTIVE"
                },
                FilterExpression: "travelogue_status = :travelogue_status"
            };
            let statusofpost = await query_dynamo(checkpoststatus);
            if (statusofpost.Count > 0) {
                let createpost = {
                    TableName: "tl_pov_table",
                    Item: {
                        pov_id: uuidv4(),
                        travelogue_id: event.travelogue_id,
                        pov_name: event.pov_name,
                        pov_duration_day: event.pov_duration_day || "",
                        pov_latitude: event.pov_latitude,
                        pov_longitude: event.pov_longitude,
                        pov_notes: event.pov_notes || "",
                        pov_created_by: accounttype.Items[0].user_name,
                        pov_status: "ACTIVE"
                    }
                };
                let postinsert = await insert_into_dynamo(createpost);
                if (postinsert == "SUCCESS") {
                    let updateSubCount = {
                        TableName: "tl_draft_travelogues",
                        Key: {
                            travelogue_id: statusofpost.Items[0].travelogue_id
                        },
                        UpdateExpression: 'Add pov_count :pov_count',
                        ExpressionAttributeValues: {
                            ':pov_count': 1,
                        }
                    };
                    await update_dynamo(updateSubCount);
                    return { Status: "SUCCESS", Message: "POV Created Successfully !!!" };
                }

                else {
                    return { Status: "ERROR", Message: "failed to create POV" };
                }
            }
            else {
                return { Status: "ERROR", Message: "Travelog has been closed" };
            }
        }
        else {
            return { Status: "ERROR", Message: "you are not an AGENT." };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }

};

/***edit_pov***/
export const edit_pov = async (event) => {
    if (await check_empty_fields(event)) {
        let checkaccounttype = {
            TableName: "tl_users_access",
            IndexName: "travelogue_id-phone_number-index",
            KeyConditionExpression: "travelogue_id = :travelogue_id and phone_number = :phone_number",
            FilterExpression: "account_type = :account_type",

            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":phone_number": event.phone_number,
                ":account_type": "AGENT"
            }
        };
        let accounttype = await query_dynamo(checkaccounttype);
        if (accounttype.Count > 0) {
            let checkpoststatus = {
                TableName: "tl_draft_travelogues",
                KeyConditionExpression: "travelogue_id = :travelogue_id",
                ExpressionAttributeValues: {
                    ":travelogue_id": accounttype.Items[0].travelogue_id,
                    ":travelogue_status": "ACTIVE"
                },
                FilterExpression: "travelogue_status = :travelogue_status"
            };
            let statusofpost = await query_dynamo(checkpoststatus);
            if (statusofpost.Count > 0) {
                let checkpovexists = {
                    TableName: "tl_pov_table",
                    KeyConditionExpression: "pov_id = :pov_id",
                    ExpressionAttributeValues: {
                        ":pov_id": event.pov_id,
                    },
                };
                let statusofpov = await query_dynamo(checkpovexists);
                if (statusofpov.Count > 0) {
                    let updateStatus = {
                        TableName: "tl_pov_table",
                        Key: {
                            pov_id: statusofpov.Items[0].pov_id
                        },
                        UpdateExpression: 'SET pov_name = :pov_name , pov_latitude = :pov_latitude , pov_longitude = :pov_longitude , pov_notes = :pov_notes , pov_duration_day = :pov_duration_day',
                        ExpressionAttributeValues: {
                            ':pov_name': event.pov_name,
                            ':pov_latitude': event.pov_latitude || "",
                            ':pov_longitude': event.pov_longitude || "",
                            ':pov_notes': event.pov_notes || "",
                            ":pov_duration_day": event.pov_duration_day || ""
                        }
                    };
                    let updateStatusResponse = await update_dynamo(updateStatus);
                    if (updateStatusResponse == "SUCCESS") {
                        return { Status: "SUCCESS", Message: "POV Edit Successfull!!!" };
                    }

                    else {
                        return { Status: "ERROR", Message: "failed to edit pov" };
                    }
                }
                else {
                    return { Status: "ERROR", Message: "Travelog has been closed" };
                }
            }
            else {
                return { Status: "ERROR", Message: "POV doesn't exist." };
            }
        }
        else {
            return { Status: "ERROR", Message: "access denied as you are a viewer." };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }

};

/***list_pov***/
export const list_pov = async (event) => {
    if (event) {
        let gettravDetails = {
            TableName: "tl_draft_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
            },
        };
        let traveloguestexist = await query_dynamo(gettravDetails);
        if (traveloguestexist.Count > 0) {
            let getpovDetails = {
                TableName: "tl_pov_table",
                IndexName: "travelogue_id-index",
                KeyConditionExpression: "travelogue_id = :travelogue_id",
                ExpressionAttributeValues: {
                    ":travelogue_id": traveloguestexist.Items[0].travelogue_id,
                    ":pov_status": "ACTIVE"
                },
                FilterExpression: "pov_status = :pov_status",
                ScanIndexForward: true
            };
            let povDetails = await query_dynamo(getpovDetails);
            if (povDetails.Count > 0) {
                return { Status: "SUCCESS", Data: povDetails.Items };
            }
            else {
                return { Status: "ERROR", Message: "POVs Not Found!!" };
            }
        }
        else {
            return { Status: "ERROR", Message: "Travelogs Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};

/***delete_pov***/
export const delete_pov = async (event) => {
    if (event) {
        let gettravDetails = {
            TableName: "tl_draft_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":travelogue_status": "ACTIVE"
            },
            FilterExpression: "travelogue_status = :travelogue_status"
        };
        let traveloguestexist = await query_dynamo(gettravDetails);
        if (traveloguestexist.Count > 0) {
            let getpovDetails = {
                TableName: "tl_pov_table",
                KeyConditionExpression: "pov_id = :pov_id",
                ExpressionAttributeValues: {
                    ":pov_id": event.pov_id,
                    ":travelogue_id": traveloguestexist.Items[0].travelogue_id,
                },
                FilterExpression: "travelogue_id = :travelogue_id"
            };
            let povDetails = await query_dynamo(getpovDetails);
            if (povDetails.Count > 0) {
                let updatedetails = {
                    TableName: "tl_pov_table",
                    Key: {
                        pov_id: povDetails.Items[0].pov_id
                    },
                    UpdateExpression: 'SET pov_status = :pov_status',
                    ExpressionAttributeValues: {
                        ':pov_status': "DEACTIVATED"
                    }
                };
                let updateStatusResponse = await update_dynamo(updatedetails);
                if (updateStatusResponse == "SUCCESS") {
                    return { Status: "SUCCESS", Message: "POV Deleted Successfully!!" };
                }
            }
            else {
                return { Status: "ERROR", Message: "POV Not Found!!" };
            }
        }
        else {
            return { Status: "ERROR", Message: "Travelogs Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};

/***post_creation***/
export const post_creation = async (event) => {
    if (await check_empty_fields(event)) {
        let checkaccounttype = {
            TableName: "tl_users_access",
            IndexName: "travelogue_id-phone_number-index",
            KeyConditionExpression: "travelogue_id = :travelogue_id and phone_number = :phone_number",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":phone_number": event.phone_number
            }
        };
        let accounttype = await query_dynamo(checkaccounttype);
        if (accounttype.Count > 0) {
            let checkpovexists = {
                TableName: "tl_pov_table",
                KeyConditionExpression: "pov_id = :pov_id",
                ExpressionAttributeValues: {
                    ":pov_id": event.pov_id,
                },
            };
            let statusofpov = await query_dynamo(checkpovexists);
            if (statusofpov.Count > 0) {
                let createpost = {
                    TableName: "tl_post_table",
                    Item: {
                        post_id: uuidv4(),
                        pov_id: statusofpov.Items[0].pov_id,
                        post_type: event.post_type,
                        post_created_on: Math.floor(new Date().getTime() / 1000),
                        post_caption: event.post_caption,
                        post_url: event.post_url,
                        media_status: "ACTIVE",
                        post_created_by: accounttype.Items[0].user_name,
                        travelogue_id: accounttype.Items[0].travelogue_id
                    }
                };
                let postinsert = await insert_into_dynamo(createpost);
                if (postinsert == "SUCCESS") {
                    update_dynamo({
                        TableName: "tl_draft_travelogues",
                        Key: {
                            travelogue_id: event.travelogue_id
                        },
                        UpdateExpression: 'Add post_count :post_count',
                        ExpressionAttributeValues: {
                            ':post_count': 1,
                        }
                    });
                    let updateSubCount = {
                        TableName: "tl_travelogues",
                        Key: {
                            travelogue_id: event.travelogue_id
                        },
                        UpdateExpression: 'Add post_count :post_count',
                        ExpressionAttributeValues: {
                            ':post_count': 1,
                        }
                    };
                    await update_dynamo(updateSubCount);
                    return { Status: "SUCCESS", Message: "Image Uploaded Successfully !!!" };
                }
                else {
                    return { Status: "ERROR", Message: "failed to create post" };
                }
            }
            else {
                return { Status: "ERROR", Message: "No Point Of View" };
            }
        }
        else {
            return { Status: "ERROR", Message: "you are not an Agent." };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};

/***list_post***/
export const list_post = async (event) => {
    if (event) {
        let getpovDetails = {
            TableName: "tl_pov_table",
            KeyConditionExpression: "pov_id = :pov_id",
            ExpressionAttributeValues: {
                ":pov_id": event.pov_id,
                ":pov_status": "ACTIVE"
            },
            FilterExpression: "pov_status = :pov_status"
        };
        let povtexist = await query_dynamo(getpovDetails);
        if (povtexist.Count > 0) {
            let getpostDetails = {
                TableName: "tl_post_table",
                IndexName: "pov_id-media_status-index",
                KeyConditionExpression: "pov_id = :pov_id  and media_status = :media_status",
                ExpressionAttributeValues: {
                    ":pov_id": povtexist.Items[0].pov_id,
                    ":media_status": "ACTIVE"

                },
                ScanIndexForward: false,
                Limit: 100,
            };
            let postDetails = await query_dynamo(getpostDetails);
            if (postDetails.Count > 0) {
                return { Status: "SUCCESS", Data: postDetails.Items, Message: "Posts Listed Successfully" };
            }
            else {
                return { Status: "ERROR", Message: "Posts Not Found!!" };
            }
        }
        else {
            return { Status: "ERROR", Message: "POV Not Found!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};

/***delete_post***/
export const delete_post = async (event) => {
    if (await check_empty_fields(event)) {
        let getPostDetails = {
            TableName: "tl_post_table",
            KeyConditionExpression: " post_id = :post_id",
            ExpressionAttributeValues: {
                ":post_id": event.post_id,
                ":media_status": "ACTIVE"
            },
            FilterExpression: "media_status = :media_status"
        };
        let postDetails = await query_dynamo(getPostDetails);
        if (postDetails.Count > 0) {
            let updateStatus = {
                TableName: "tl_post_table",
                Key: {
                    post_id: postDetails.Items[0].post_id
                },
                UpdateExpression: 'SET media_status = :media_status',
                ExpressionAttributeValues: {
                    ':media_status': "DEACTIVATED",
                }
            };
            await update_dynamo(updateStatus);
            return { Status: "SUCCESS", Message: "Image Deleted Successfully" };
        }
        else {
            return { Status: "ERROR", Message: "couldn't Delete Media!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }

};

/***list_approved_agent_travelogues***/
export const list_approved_agent_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_draft_travelogues",
            IndexName: "travelogue_availability-travelogue_status-index",
            KeyConditionExpression: " travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_availability": "APPROVED",
                ":travelogue_status": "ACTIVE",
                ":phone_number": event.phone_number,
                ":Approval_status": "APPROVED"
            },
            FilterExpression: "phone_number = :phone_number and Approval_status = :Approval_status"
        };
        let publicDetails = await query_dynamo(getpublicDetails);
        if (publicDetails.Count > 0) {
            return { Status: "SUCCESS", Data: publicDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "Approved travelogs Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};


/***list_approved_travelogues***/
// export const list_approved_travelogues = async (event) => {
//     if (await check_empty_fields(event)) {
//         let getpublicDetails = {
//             TableName: "tl_travelogues",
//             IndexName: "travelogue_availability-travelogue_status-index",
//             KeyConditionExpression: " travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
//             ExpressionAttributeValues: {
//                 ":travelogue_availability": "APPROVED",
//                 ":travelogue_status": "ACTIVE",
//                 ":Approval_status": "APPROVED"
//             },
//             FilterExpression: "Approval_status = :Approval_status"
//         };


//         let publicDetails = await query_dynamo(getpublicDetails);
//         if (publicDetails.Count > 0) {
//             return { Status: "SUCCESS", Data: publicDetails.Items };
//         }
//         else {
//             return { Status: "ERROR", Message: "Approved travelogs Not Found!!!" };
//         }
//     }
//     else {
//         return { Status: "ERROR", Message: "Empty Field Occured" };
//     }
// };



export const list_approved_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_travelogues",
            IndexName: "travelogue_availability-travelogue_status-index",
            KeyConditionExpression: " travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_availability": "APPROVED",
                ":travelogue_status": "ACTIVE",
                ":Approval_status": "APPROVED"
            },
            FilterExpression: "Approval_status = :Approval_status",
            // Limit: 2

        };
        if (event.next_token != null && event.next_token != undefined) {
            console.log("next_token")
            getpublicDetails.ExclusiveStartKey = JSON.parse(Buffer.from(event.next_token.trim(), 'base64').toString('ascii'));
        }
        console.log("getpublicDetails", getpublicDetails)
        let publicDetails = await query_dynamo(getpublicDetails);
        if (publicDetails.Count > 0) {
            console.log("publicDetails", publicDetails)
            let response = {};
            response.items = publicDetails.Items;
            if (publicDetails.LastEvaluatedKey != undefined && publicDetails.LastEvaluatedKey != null) {
                response.next_token = Buffer.from(JSON.stringify(publicDetails.LastEvaluatedKey)).toString('base64');
            }
            return { Status: "SUCCESS", Data: response };
        }
        else {
            return { Status: "ERROR", Message: "Empty Field Occured" };
        }

    }
};








/***verifiy_otp_through_cognito***/
export const verifiy_otp_through_cognito = async (event) => {
    try {
        const input = {
            UserPoolId: process.env.pool_id,
            ClientId: process.env.client_id,
            ChallengeName: "CUSTOM_CHALLENGE",
            ChallengeResponses: {
                "USERNAME": event.agent_email,
                "ANSWER": event.otp
            },
            Session: event.session
        };
        const response = await new CognitoIdentityProviderClient().send(new RespondToAuthChallengeCommand(input));
        if (response['$metadata'].httpStatusCode == 200) {
            return { Status: "SUCCESS", Message: "OTP verified Successfully!!", AccessToken: response.AuthenticationResult.AccessToken, user_email_id: event.user_email_id };
        }
        else {
            return { Status: "ERROR", Message: "Invalid OTP!!" };
        }
    }
    catch (err) {
        return { Status: "ERROR", Message: "Invalid OTP!!" };
    }
};



/***generate_otp_through_cognito***/
export const generate_otp_through_cognito = async (event) => {
    try {
        let getUserDetails = {
            TableName: 'tl_agent',
            IndexName: 'agent_email-agent_status-index',
            KeyConditionExpression: 'agent_email = :agent_email and agent_status = :agent_status',
            ExpressionAttributeValues: {
                ':agent_email': event.agent_email,
                ':agent_status': "ACTIVE"
            },
        };
        let userDetails = await query_dynamo(getUserDetails);
        if (userDetails.Count > 0) {
            const input = {
                UserPoolId: process.env.UserPoolId,
                ClientId: process.env.ClientId,
                AuthFlow: "CUSTOM_AUTH",
                AuthParameters: {
                    "USERNAME": userDetails.Items[0].agent_email,
                    "PASSWORD": "Mobil80@123"
                },
            };
            let response = await new CognitoIdentityProviderClient().send(new AdminInitiateAuthCommand(input));
            console.log("respnse11", response);
            return { Status: "SUCCESS", Message: "OTP Sent Successfully!!", session: response.Session };
        }
        else {
            return { Status: "USRNT", Message: "Access Denied, Unable to generate OTP" };
        }
    }
    catch (e) {
        return {
            Status: "ERROR",
            Message: e //"Couldn't find your account" 
        };
    }
};



/***travelogS3URL***/
const travelogS3URL = async (event) => {
    try {
        let REGION = process.env.REGION;
        let BUCKET = process.env.BUCKET;
        let KEY = event.key;

        const client = new S3Client({ region: REGION });
        const command = new PutObjectCommand({ Bucket: BUCKET, Key: KEY });

        const presignedUrl = await getSignedUrl(client, command, { expiresIn: 36000 });
        console.log("Presigned URL:", presignedUrl);

        return {
            status: "Success",
            message: presignedUrl
        };
    }
    catch (err) {
        console.error(err);
        throw new Error(err);
    }
};


export const handler = async (event) => {
    switch (event.command) {
        case "agent_travelogue_creation":
            return await agent_travelogue_creation(event);

        case "get_agent":
            return await get_agent(event);

        case "verifiy_otp_through_cognito":
            return await verifiy_otp_through_cognito(event);

        case "generate_otp_through_cognito":
            return await generate_otp_through_cognito(event);

        case "delete_travelogue_status":
            return await delete_travelogue_status(event);

        case "update_travelogue_details":
            return await update_travelogue_details(event);

        case "delete_post":
            return await delete_post(event);

        case "pov_creation":
            return await pov_creation(event);

        case "list_pov":
            return await list_pov(event);

        case "post_creation":
            return await post_creation(event);

        case "list_post":
            return await list_post(event);

        case "edit_pov":
            return await edit_pov(event);

        case "delete_pov":
            return await delete_pov(event);

        case "publish_travelogue":
            return await publish_travelogue(event);

        case "list_pending_approval_travelogues":
            return await list_pending_approval_travelogues(event);

        case "list_rejected_travelogues":
            return await list_rejected_travelogues(event);

        case "travelogS3URL":
            return await travelogS3URL(event);

        case "list_my_draft_travelogues":
            return await list_my_draft_travelogues(event);

        case "list_approved_agent_travelogues":
            return await list_approved_agent_travelogues(event);


        case "list_approved_travelogues":
            return await list_approved_travelogues(event);

        default:
            throw new Error("Commad Not Found!");

    }
};
