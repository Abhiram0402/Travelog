import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";


import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminDeleteUserCommand, AdminGetUserCommand, InitiateAuthCommand, AdminDisableUserCommand, AdminEnableUserCommand } from "@aws-sdk/client-cognito-identity-provider";
const cognito_client = new CognitoIdentityProviderClient({ apiVersion: "2016-04-18" });

import { v4 as uuidv4 } from 'uuid';

import axios from 'axios';
import fs from 'fs/promises';
import XLSX from 'xlsx';
import ddb from "@aws-sdk/lib-dynamodb";
import * as dynamodb from "@aws-sdk/client-dynamodb";

const docClient = new dynamodb.DynamoDBClient();
const ddbDocClient = ddb.DynamoDBDocumentClient.from(docClient, {
    marshallOptions: {
        removeUndefinedValues: true,
    },
});
import { BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';

const query_dynamo = async (params) => {
    try {
        let command = new ddb.QueryCommand(params);
        const data = await ddbDocClient.send(command);
        return data;
    }
    catch (err) {
        console.log(params, err);
        throw new Error(err);
    }
};

const scan_dynamo = async (params) => {
    try {
        let command = new ddb.ScanCommand(params);
        const data = await ddbDocClient.send(command);
        return data;
    }
    catch (err) {
        console.log(params, err);
        throw new Error(err);
    }
};

const insert_into_dynamo = async (params) => {
    try {
        let command = new ddb.PutCommand(params);
        await ddbDocClient.send(command);
        return "SUCCESS";
    }
    catch (err) {
        console.log(params, err);
        throw new Error(err);
    }
};

const update_dynamo = async (params) => {
    try {
        let command = new ddb.UpdateCommand(params);
        await ddbDocClient.send(command);
        return "SUCCESS";
    }
    catch (err) {
        console.log(params, err);
        throw new Error(err);
    }
};

export const delete_dynamo = async (params) => {
    try {
        await ddbDocClient.send(new ddb.DeleteCommand(params));
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
        const results = await ddbDocClient.send(new ddb.QueryCommand(event));
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

async function create_cognito_user(email_id, poolId, temp_pass, resendInvitation, suppress) {
    let params = {
        UserPoolId: poolId,
        Username: email_id.trim().toLowerCase(),
        UserAttributes: [{
                Name: "email",
                Value: email_id.trim().toLowerCase(),
            },
            {
                Name: "email_verified",
                Value: "true",
            },
        ],
        TemporaryPassword: temp_pass,
    };
    try {
        if (resendInvitation) {
            params.MessageAction = "RESEND";
        }
        if (suppress) {
            params.MessageAction = "SUPPRESS";
        }
        const command = new AdminCreateUserCommand(params);
        let response = await cognito_client.send(command);
        if (response.$metadata) {
            return {
                status: "SUCCESS",
                user_details: response.User
            }
        }
        else {
            throw new Error("Can't Create Cognito User!!")
        }

    }
    catch (err) {
        console.log(params, err);
        throw new Error(err);
    }
}

async function delete_cognito_user(email_id, poolId) {
    let params = {
        UserPoolId: poolId,
        Username: email_id,
    };
    try {
        let command = new AdminDeleteUserCommand(params);
        await cognito_client.send(command);
        return "Success";
    }
    catch (err) {
        console.log(params, err);
        throw new Error(err);
    }
}


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

async function checkCognitoUser(user_email_id) {
    try {
        const command = new AdminGetUserCommand({
            UserPoolId: process.env.pool_id,
            Username: user_email_id,
        });
        await new CognitoIdentityProviderClient().send(command);
        return false;
    }
    catch (error) {
        return true;
    }
}

async function checkAdminCognitoUser(user_email_id) {
    try {
        const command = new AdminGetUserCommand({
            UserPoolId: process.env.admin_pool_id,
            Username: user_email_id,
        });
        await new CognitoIdentityProviderClient().send(command);
        return false;
    }
    catch (error) {
        return true;
    }
}

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
        const results = await ddbDocClient.send(new ddb.BatchGetCommand(params));
        all_resposne.push(results.Responses[tablename]);
    }
    return all_resposne.flat(Infinity);
};


/******************************************************************************************************************************************************************************************************************/

async function send_ses_email(event) {
    console.log("event of send ses email--->", event);
    const sesClient = new SESClient({
        region: "ap-south-1",
        // credentials: {
        //     accessKeyId: "ASIATLYRMTVOIIGYAEHI",
        //     secretAccessKey: "7wTt3Vu6EzUb71jtc9WueH7F/Gx1GQK2FzXMg8/0"
        // },
    });

    let params = {
        Source: "no-reply@zipcast.app",
        Destination: {
            ToAddresses: [event.admin_email]
        },
        Message: {
            Subject: {
                Data: 'You are onboarded!!',
            },
            Body: {
                Html: {
                    Data: 'You are onboarded in Travelogue kindly login to portal',
                },
            },
        },
    };

    const sendEmailCommand = new SendEmailCommand(params);

    try {
        const response = await sesClient.send(sendEmailCommand);
        return 'SUCCESS!!';
    }
    catch (error) {
        console.error("Error sending email:", error);
        throw error;
    }
}



async function send_email_for_agent(event) {
    console.log("event of send ses email--->", event);
    const sesClient = new SESClient({
        region: "ap-south-1",
        // credentials: {
        //     accessKeyId: "ASIATLYRMTVOIIGYAEHI",
        //     secretAccessKey: "7wTt3Vu6EzUb71jtc9WueH7F/Gx1GQK2FzXMg8/0"
        // },
    });

    let params = {
        Source: "no-reply@zipcast.app",
        Destination: {
            ToAddresses: [event.agent_email]
        },
        Message: {
            Subject: {
                Data: 'You are onboarded as an agent!!',
            },
            Body: {
                Html: {
                    Data: 'Kindly login to agent portal',
                },
            },
        },
    };

    const sendEmailCommand = new SendEmailCommand(params);

    try {
        const response = await sesClient.send(sendEmailCommand);
        return 'SUCCESS!!';
    }
    catch (error) {
        console.error("Error sending email:", error);
        throw error;
    }
}



export const create_admin = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event));

        // Check if admin exists
        const checkAdminExists = {
            TableName: "tl_admin",
            KeyConditionExpression: "admin_id = :admin_id",
            ExpressionAttributeValues: {
                ":admin_id": event.cognito_email.username
            }
        };
        const adminDetails = await query_dynamo(checkAdminExists);
        console.log("Admin details:", JSON.stringify(adminDetails));

        if (adminDetails.Count > 0) {
            // Admin exists, proceed to check if user exists
            const checkIfTheUserExistsParam = {
                TableName: "tl_admin",
                IndexName: "admin_email-admin_status-index",
                KeyConditionExpression: "admin_email = :admin_email AND admin_status = :admin_status",
                ExpressionAttributeValues: {
                    ":admin_email": event.admin_email,
                    ":admin_status": "ACTIVE"
                }
            };
            const user = await query_dynamo(checkIfTheUserExistsParam);
            console.log("User details:", JSON.stringify(user));

            if (user.Items.length === 0) {
                // User does not exist, proceed to create new user
                await create_cognito_user(event.admin_email, process.env.admin_pool_id, "123456", false);
                console.log("Cognito user created successfully.");

                const res = await send_ses_email(event);
                console.log("Email sending response:",);

                if (res === 'SUCCESS!!') {
                // Email sent successfully, proceed with user creation
                let userParams = {
                    UserPoolId: process.env.admin_pool_id,
                    Username: event.admin_email.toLowerCase().trim(),
                };
                let cognito_user = await cognito_client.send(new AdminGetUserCommand(userParams));
                console.log("cognito_user", cognito_user);

                if (cognito_user.UserStatus === "FORCE_CHANGE_PASSWORD") {
                    // Force password change if required
                    let masterUserParams = {
                        UserPoolId: process.env.admin_pool_id,
                        Username: event.admin_email.toLowerCase().trim(),
                    };
                    await cognito_client.send(new AdminGetUserCommand(masterUserParams));

                    let userParams = {
                        AuthFlow: "USER_PASSWORD_AUTH",
                        ClientId: process.env.admin_client_id,
                        AuthParameters: {
                            USERNAME: event.admin_email.toLowerCase().trim(),
                            PASSWORD: '123456',
                        },
                    };

                    const cognitoData = await cognito_client.send(new InitiateAuthCommand(userParams));
                    console.log("Cognito data:", JSON.stringify(cognitoData));

                    if (cognitoData) {
                        // Insert user details into DynamoDB
                        const createUserParams = {
                            TableName: "tl_admin",
                            Item: {
                                admin_id: cognito_user.Username,
                                admin_name: event.admin_name,
                                admin_email: event.admin_email,
                                user_type: event.user_type,
                                admin_status: 'ACTIVE',
                                created_on: Date.now()
                            }
                        };
                        await insert_into_dynamo(createUserParams);
                        return {
                            status: 'Success',
                            status_message: `${event.user_type} created and Invited successfully!!`
                        };
                    }
                    else {
                        throw new Error("Invalid Username Or Password Entered");
                    }
                }
                }
                else {
                    throw new Error('Something went wrong in email sending!!');
                }
            }
            else {
                throw new Error('User already exists with the same email id!!');
            }
        }
        else {
            throw new Error('Admin with provided ID does not exist!!');
        }
    }
    catch (error) {
        console.error("Error occurred:", error);
        throw error;
    }
};




// export const create_admin = async (event) => {
//     if (await check_empty_fields(event)) {
//         if (await checkAdminCognitoUser(event.admin_email.toLowerCase())) {
//             let checkUserAlreadyExist = {
//                 TableName: "tl_admin",
//                 IndexName: "admin_email-admin_status-index",
//                 KeyConditionExpression: "admin_email = :admin_email and admin_status = :admin_status",
//                 ExpressionAttributeValues: {
//                     ":admin_email": event.admin_email,
//                     ":admin_status": "ACTIVE"
//                 },
//             };
//             let UserDetails = await query_dynamo(checkUserAlreadyExist);
//             if (UserDetails.Count < 1) {
//                 let inserUser = {
//                     TableName: "tl_admin",
//                     Item: {
//                         admin_id: uuidv4(),
//                         admin_name: event.admin_name,
//                         admin_email: event.admin_email,
//                         user_type: event.user_type,
//                         admin_status: 'ACTIVE',
//                         created_on: Date.now()
//                     }
//                 };
//                 let createResponse = await insert_into_dynamo(inserUser);
//                 await signUpAdminCognitoUser(event.admin_email.toLowerCase())
//                 if (createResponse == "SUCCESS") {
//                     return { Status: "SUCCESS", Message: "BMS Created Successfully!!!" };
//                 }
//                 else {
//                     return { Status: "ERROR", Message: "BMS user already exists" };
//                 }
//             }
//             else {
//                 return { Status: "ERROR", Message: "Empty Field Occurred" };
//             }
//         }
//     }
// };


/***get_admin***/
export const get_admin = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserAlreadyExist = {
            TableName: "tl_admin",
            IndexName: "admin_email-admin_status-index",
            KeyConditionExpression: "admin_email = :admin_email and admin_status = :admin_status",
            ExpressionAttributeValues: {
                ":admin_email": event.admin_email,
                ":admin_status": "ACTIVE"
            },
        };
        let UserDetails = await query_dynamo(checkUserAlreadyExist);
        if (UserDetails.Count > 0) {
            return { Status: "SUCCESS", Data: UserDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "User Not Found!!!" };
        }
    }
};

/***create_agent***/
export const create_agent = async (event) => {
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
            return { Status: "ERROR", Message: "Agent Already Exists!!!" };
        }
        else {
            await create_cognito_user(event.agent_email, process.env.pool_id, "123456", false);
            console.log("Cognito user created successfully.");

            const res = await send_email_for_agent(event);
            console.log("Email sending response:", res);
            if (res === 'SUCCESS!!') {
                // Email sent successfully, proceed with user creation
                let userParams = {
                    UserPoolId: process.env.pool_id,
                    Username: event.agent_email.toLowerCase().trim(),
                };
                let cognito_user = await cognito_client.send(new AdminGetUserCommand(userParams));
                console.log("cognito_user", cognito_user);

                if (cognito_user.UserStatus === "FORCE_CHANGE_PASSWORD") {
                    // Force password change if required
                    let masterUserParams = {
                        UserPoolId: process.env.pool_id,
                        Username: event.agent_email.toLowerCase().trim(),
                    };
                    await cognito_client.send(new AdminGetUserCommand(masterUserParams));

                    let userParams = {
                        AuthFlow: "USER_PASSWORD_AUTH",
                        ClientId: process.env.client_id,
                        AuthParameters: {
                            USERNAME: event.agent_email.toLowerCase().trim(),
                            PASSWORD: '123456',
                        },
                    };

                    const cognitoData = await cognito_client.send(new InitiateAuthCommand(userParams));
                    console.log("Cognito data:", JSON.stringify(cognitoData));

                    if (cognitoData) {


                        let inserUser = {
                            TableName: "tl_agent",
                            Item: {
                                agent_id: cognito_user.Username,
                                travel_agency_name: event.travel_agency_name,
                                agent_name: event.agent_name,
                                agent_email: event.agent_email,
                                agent_phone_number: event.agent_phone_number || "",
                                country_code: event.country_code,
                                agent_created_on: Math.floor(new Date().getTime() / 1000),
                                agent_status: 'ACTIVE',
                                subscription_status: "DEACTIVATED",
                                logo: event.logo
                            }
                        };
                        let createResponse = await insert_into_dynamo(inserUser);

                        if (createResponse === "SUCCESS") {
                            return { Status: "SUCCESS", Message: "Agent Created Successfully!!!" };
                        }
                        else {
                            return { Status: "ERROR", Message: "Failed To Create Agent" };
                        }
                    }

                }
            }
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};










/***list_all_agents***/
export const list_all_agents = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserExist = {
            TableName: "tl_agent",
            IndexName: "agent_status-index",
            KeyConditionExpression: "agent_status = :agent_status",
            ExpressionAttributeValues: {
                ":agent_status": "ACTIVE"
            }
        };
        let UserDetails = await query_dynamo(checkUserExist);
        if (UserDetails.Count > 0) {
            return { Status: "SUCCESS", Data: UserDetails.Items, totalCount: UserDetails.Count };
        }
        else {
            return { Status: "ERROR", Message: "User Not Found!!!" };
        }
    }
};

/***create_agent_subscription***/
export const create_agent_subscription = async (event) => {
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
            let getpackageDetails = {
                TableName: "tl_package",
                IndexName: "package_type-package_status-index",
                KeyConditionExpression: "package_type = :package_type and package_status = :package_status",
                ExpressionAttributeValues: {
                    ":package_type": "Premium",
                    ":package_status": "ACTIVE"
                }
            };
            let packageDetails = await query_dynamo(getpackageDetails);
            if (packageDetails.Count > 0) {
                let checksubscription = {
                    TableName: "tl_subscription_table",
                    IndexName: "subscriber_id-subscription_status-index",
                    KeyConditionExpression: "subscriber_id = :subscriber_id and subscription_status = :subscription_status",
                    ExpressionAttributeValues: {
                        ":subscriber_id": UserDetails.Items[0].agent_id,
                        ":subscription_status": "ACTIVE",
                        ":package_type": "Premium"
                    },
                    FilterExpression: "package_type = :package_type",
                };
                let subscriptionDetails = await query_dynamo(checksubscription);
                if (subscriptionDetails.Count === 0) {
                    let createSubscription = {
                        TableName: "tl_subscription_table",
                        Item: {
                            subscription_id: uuidv4(),
                            subscriber_id: UserDetails.Items[0].user_id,
                            subscriber_phone_number: UserDetails.Items[0].phone_number,
                            user_name: UserDetails.Items[0].user_name,
                            package_id: packageDetails.Items[0].package_id,
                            package_type: packageDetails.Items[0].package_type,
                            sub_start_date: Math.floor(new Date().getTime() / 1000),
                            sub_end_date: Math.floor(new Date().getTime() / 1000) + Math.floor(3.154e+10 / 1000),
                            subscription_status: "ACTIVE"
                        }
                    };
                    let updateSubStatus = {
                        TableName: "tl_app_user",
                        Key: {
                            user_id: UserDetails.Items[0].user_id
                        },
                        UpdateExpression: 'set subscription_status = :subscription_status',
                        ExpressionAttributeValues: {
                            ':subscription_status': "ACTIVE",
                        }
                    };
                    let subscriptionResponse = await insert_into_dynamo(createSubscription);
                    if (subscriptionResponse === "SUCCESS") {
                        await update_dynamo(updateSubStatus);
                        return { Status: "SUCCESS", Message: "Subscription Created Successfully!!" };
                    }
                    else {
                        return { Status: "ERROR", Message: "Some error occurred during the creation of subscription" };
                    }
                }
                else {
                    return { Status: "ERROR", Message: "You are already a PREMIUM Member." };
                }
            }
            else {
                return { Status: "ERROR", Message: "Please select the package!!!" };
            }
        }
        else {
            return { Status: "ERROR", Message: "User not found or is not active" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***list_all_agent_travelogues***/
export const list_all_agent_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getTravelogueDetails = {
            TableName: "tl_draft_travelogues",
            IndexName: "travelogue_availability-travelogue_status-index",
            KeyConditionExpression: "travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_availability": "DRAFT",
                ":travelogue_status": "ACTIVE"
            },
        };
        let travelogueDetails = await query_dynamo(getTravelogueDetails);
        if (travelogueDetails.Count > 0) {
            return { Status: "SUCCESS", Data: travelogueDetails.Items, totalCount: travelogueDetails.Count };
        }
        else {
            return { Status: "ERROR", Message: "Travelogs Not Found!!!" };
        }
    }
};

/***list_agent_travelogues***/
export const list_agent_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getTravelogueDetails = {
            TableName: "tl_draft_travelogues",
            IndexName: "travelogue_availability-travelogue_status-index",
            KeyConditionExpression: "travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_availability": "DRAFT",
                ":travelogue_status": "ACTIVE",
                ":phone_number": event.phone_number
            },
            FilterExpression: "phone_number = :phone_number"
        };
        let travelogueDetails = await query_dynamo(getTravelogueDetails);
        if (travelogueDetails.Count > 0) {
            return { Status: "SUCCESS", Data: travelogueDetails.Items, totalCount: travelogueDetails.Co };
        }
        else {
            return { Status: "ERROR", Message: "No Travelogs Found!!!" };
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
                FilterExpression: "pov_status = :pov_status"
            };
            let povDetails = await query_dynamo(getpovDetails);
            if (povDetails.Count > 0) {
                return { Status: "SUCCESS", Data: povDetails.Items, totalCount: povDetails.Count };
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

/***list_post***/
export const list_post = async (event) => {
    if (event) {
        let getpovDetails = {
            TableName: "tl_pov_table",
            KeyConditionExpression: "pov_id = :pov_id",
            ExpressionAttributeValues: {
                ":pov_id": event.pov_id,
            },
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
                // Limit: 100,
            };
            let postDetails = await query_dynamo(getpostDetails);
            if (postDetails.Count > 0) {
                return { Status: "SUCCESS", Data: postDetails.Items, Message: "Posts listed successfully" };
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

/***Reject_pending_travelogues***/
export const Reject_pending_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_draft_travelogues",
            KeyConditionExpression: " travelogue_id = :travelogue_id",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":travelogue_availability": "PENDING_APPROVAL"
            },
            FilterExpression: "travelogue_availability = :travelogue_availability"
        };
        let publicDetails = await query_dynamo(getpublicDetails);
        if (publicDetails.Count > 0) {
            let updateStatus = {
                TableName: "tl_draft_travelogues",
                Key: {
                    travelogue_id: publicDetails.Items[0].travelogue_id
                },
                UpdateExpression: 'SET travelogue_availability = :travelogue_availability , rejection_reason = :rejection_reason , Approval_status = :Approval_status ',
                ExpressionAttributeValues: {
                    ':travelogue_availability': "REJECTED",
                    ":rejection_reason": event.rejection_reason,
                    ":Approval_status": "REJECTED"
                }
            };
            await update_dynamo(updateStatus);
            return { Status: "SUCCESS", Message: "Please recreate the travelogue as it cannot be published due to compliance issues" };
        }
        else {
            return { Status: "ERROR", Message: "couldn't Reject the travelogue!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }

};

/***list_agent_pending_approval_travelogues***/
export const list_agent_pending_approval_travelogues = async (event) => {
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
            return { Status: "SUCCESS", Data: publicDetails.Items, totalCount: publicDetails.Count };
        }
        else {
            return { Status: "ERROR", Message: "pending approval travelogs Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***list_agent_rejected_travelogues***/
export const list_agent_rejected_travelogues = async (event) => {
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
            return { Status: "SUCCESS", Data: publicDetails.Items, totalCount: publicDetails.Count };
        }
        else {
            return { Status: "ERROR", Message: "rejected travelogs Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***approve_pending_travelogues***/
export const approve_pending_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_draft_travelogues",
            KeyConditionExpression: " travelogue_id = :travelogue_id",
            FilterExpression: "travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":travelogue_status": "ACTIVE",
                ":travelogue_availability": "PENDING_APPROVAL"
            },
        };
        let publicDetails = await query_dynamo(getpublicDetails);
        if (publicDetails.Count > 0) {
            let updateStatus = {
                TableName: "tl_draft_travelogues",
                Key: {
                    travelogue_id: publicDetails.Items[0].travelogue_id
                },
                UpdateExpression: 'SET travelogue_availability = :travelogue_availability , Approval_status = :Approval_status',
                ExpressionAttributeValues: {
                    ':travelogue_availability': "APPROVED",
                    ":Approval_status": "APPROVED"
                }
            };
            await update_dynamo(updateStatus);
            let createtravelogue = {
                TableName: "tl_travelogues",
                Item: {
                    travelogue_id: publicDetails.Items[0].travelogue_id,
                    user_id: publicDetails.Items[0].user_id,
                    phone_number: publicDetails.Items[0].phone_number,
                    country_code: publicDetails.Items[0].country_code,
                    user_status: publicDetails.Items[0].user_status,
                    agent_email: publicDetails.Items[0].agent_email,
                    travelogue_name: publicDetails.Items[0].travelogue_name,
                    travelogue_image: publicDetails.Items[0].travelogue_image,
                    travelogue_description: publicDetails.Items[0].travelogue_description,
                    travelogue_created_on: publicDetails.Items[0].travelogue_created_on,
                    travelogue_created_by: publicDetails.Items[0].travelogue_created_by,
                    travelogue_status: publicDetails.Items[0].travelogue_status,
                    travelogue_availability: "APPROVED",
                    Approval_status: "APPROVED",
                    account_type: publicDetails.Items[0].account_type,
                    pov_count: publicDetails.Items[0].pov_count,
                    post_count: publicDetails.Items[0].post_count,
                    travelogue_Departure_state: publicDetails.Items[0].travelogue_Departure_state,
                    travelogue_Departure_country: publicDetails.Items[0].travelogue_Departure_country
                }
            };
            let createResponse = await insert_into_dynamo(createtravelogue);
            if (createResponse == "SUCCESS") {

                return { Status: "SUCCESS", Message: "Congratulations, your Travelogue will be Featured to PUBLIC", Data: updateStatus.Items };
            }
            else {
                throw new Error("ERROR");
            }
        }
        else {
            return { Status: "ERROR", Message: "travelog not found!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }

};

/***list_users***/
export const list_users = async (event) => {
    if (await check_empty_fields(event)) {
        let getUserDetails = {
            TableName: "tl_app_user",
            IndexName: "user_status-index",
            KeyConditionExpression: "user_status = :user_status",
            ExpressionAttributeValues: {
                ":user_status": "ACTIVE",
            },
            ScanIndexForward: false,
            Limit: 100
        };
        let userDetails = await query_dynamo(getUserDetails);
        if (userDetails.Count > 0) {
            return { Status: "SUCCESS", Data: userDetails.Items, totalCount: userDetails.Count };
        }
        else {
            return { Status: "ERROR", Message: "users Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***deactivate_agent***/
export const deactivate_agent = async (event) => {
    if (await check_empty_fields(event)) {
        let checkGlobalUserExist = {
            TableName: "tl_agent",
            IndexName: "agent_phone_number-agent_status-index",
            KeyConditionExpression: "agent_phone_number = :agent_phone_number and agent_status = :agent_status",
            ExpressionAttributeValues: {
                ":agent_phone_number": event.agent_phone_number,
                ":agent_status": "ACTIVE"
            }
        };
        let globaluserDetails = await query_dynamo(checkGlobalUserExist);
        if (globaluserDetails.Count > 0) {
            let checkMappingUserExist = {
                TableName: "tl_users_access",
                IndexName: "phone_number-user_status-index",
                KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
                ExpressionAttributeValues: {
                    ":phone_number": globaluserDetails.Items[0].agent_phone_number,
                    ":user_status": "ACTIVE",
                    ":account_type": "AGENT"
                },
                FilterExpression: "account_type = :account_type"
            };
            let mappinguserDetails = await query_dynamo(checkMappingUserExist);
            if (mappinguserDetails.Count > 0) {
                await update_dynamo({
                    TableName: "tl_agent",
                    Key: {
                        agent_id: globaluserDetails.Items[0].agent_id
                    },
                    UpdateExpression: 'SET agent_status = :agent_status',
                    ExpressionAttributeValues: {
                        ':agent_status': "DEACTIVATED"
                    }
                });
                for (let s = 0; s < mappinguserDetails.Items.length; s++) {
                    let updatemapping = {
                        TableName: "tl_users_access",
                        Key: {
                            mapping_id: mappinguserDetails.Items[s].mapping_id
                        },
                        UpdateExpression: 'SET user_status = :user_status',
                        ExpressionAttributeValues: {
                            ':user_status': "DEACTIVATED"
                        }
                    };
                    await update_dynamo(updatemapping);
                }
                return { Status: "SUCCESS", Message: "Agent deactivated successfully!!!" };

            }
            else {
                return { Status: "ERROR", Message: "Agent not found" };

            }
        }
        else {
            return { Status: "ERROR", Message: "Issue with agent mapping " };
        }
    }

    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***list_all_pending_approval_travelogues***/
export const list_all_pending_approval_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_draft_travelogues",
            IndexName: "travelogue_availability-travelogue_status-index",
            KeyConditionExpression: " travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_availability": "PENDING_APPROVAL",
                ":travelogue_status": "ACTIVE",
            },
        };
        let publicDetails = await query_dynamo(getpublicDetails);
        if (publicDetails.Count > 0) {
            return { Status: "SUCCESS", Data: publicDetails.Items, totalCount: publicDetails.Count };
        }
        else {
            return { Status: "ERROR", Message: "pending approval travelogs Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***list_all_rejected_travelogues***/
export const list_all_rejected_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_draft_travelogues",
            IndexName: "travelogue_availability-travelogue_status-index",
            KeyConditionExpression: " travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_availability": "REJECTED",
                ":travelogue_status": "ACTIVE"
            },
        };
        let publicDetails = await query_dynamo(getpublicDetails);
        if (publicDetails.Count > 0) {
            return { Status: "SUCCESS", Data: publicDetails.Items, totalCount: publicDetails.Count };
        }
        else {
            return { Status: "ERROR", Message: "rejected travelogs Not Found!!!" };
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
            return { Status: "SUCCESS", Data: publicDetails.Items, totalCount: publicDetails.Count };
        }
        else {
            return { Status: "ERROR", Message: "rejected travelogs Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***list_all_approved_agent_travelogues***/
export const list_all_approved_agent_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_draft_travelogues",
            IndexName: "travelogue_availability-travelogue_status-index",
            KeyConditionExpression: " travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_availability": "APPROVED",
                ":travelogue_status": "ACTIVE",
                ":Approval_status": "APPROVED"
            },
            FilterExpression: "Approval_status = :Approval_status"
        };
        let publicDetails = await query_dynamo(getpublicDetails);
        if (publicDetails.Count > 0) {
            return { Status: "SUCCESS", Data: publicDetails.Items, totalCount: publicDetails.Count };
        }
        else {
            return { Status: "ERROR", Message: "rejected travelogs Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

async function list_all_travelogues(event) {
    const input = {
        TableName: "tl_travelogues",

    }

    const result = await scan_dynamo(input);
    return {
        items: result.Items,
        totalCount: result.Count
    };
}

async function list_all_bms_users(event) {
    const input = {
        TableName: "tl_admin"
    };

    const result = await scan_dynamo(input);
    return {
        items: result.Items,
        totalCount: result.Count
    };
}

/************************************ POV ********************************************/

async function create_pov(event) {
    const check_bms_user_exists = {
        TableName: "tl_admin",

        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    const userDetails = await query_dynamo(check_bms_user_exists);
    console.log("result", userDetails);
    if (userDetails.Count > 0 && userDetails.Items[0].user_type === "ADMIN") {
        const pov_creation_input = {
            TableName: "tl_global_pov",
            Item: {
                pov_id: uuidv4(),
                pov_name: event.pov_name,
                pov_description: event.pov_description,
                pov_latitude: event.pov_latitude,
                pov_longitude: event.pov_longitude,
                pov_created_on: Date.now(),
                creator_user_type: "ADMIN",
                created_by: userDetails.Items[0].admin_id,
                creator_name: userDetails.Items[0].admin_name,

                pov_status: "APPROVED",
                post_url: []
            },
        };
        const result = await insert_into_dynamo(pov_creation_input);
        // console.log("result", result);
        return { status: 200, Message: "POV created successfully!", pov_id: pov_creation_input.Item.pov_id };
    }
    if (userDetails.Count > 0 && userDetails.Items[0].user_type === "POV_CURATOR") {
        const pov_creation_input_by_curator = {
            TableName: "tl_pov_curator_drafts",
            Item: {
                pov_id: uuidv4(),
                pov_name: event.pov_name,
                pov_description: event.pov_description,
                pov_latitude: event.pov_latitude,
                pov_longitude: event.pov_longitude,
                pov_created_on: Date.now(),
                creator_user_type: "POV_CURATOR",
                created_by: userDetails.Items[0].admin_id,
                creator_name: userDetails.Items[0].admin_name,

                pov_status: "PENDING",
                post_url: []
            },
        };
        const result = await insert_into_dynamo(pov_creation_input_by_curator);
        console.log("result", result);
        if (result === "SUCCESS") {
            const insertIntoGlobalPovTableParams = {
                TableName: "tl_global_pov",
                Item: {
                    pov_id: pov_creation_input_by_curator.Item.pov_id,
                    pov_name: pov_creation_input_by_curator.Item.pov_name,
                    pov_description: pov_creation_input_by_curator.Item.pov_description,
                    pov_latitude: pov_creation_input_by_curator.Item.pov_latitude,
                    pov_longitude: pov_creation_input_by_curator.Item.pov_longitude,
                    pov_created_on: Date.now(),
                    creator_user_type: "POV_CURATOR",
                    created_by: userDetails.Items[0].admin_id,
                    creator_name: userDetails.Items[0].admin_name,
                    pov_status: "PENDING",
                    post_url: []
                }
            }
            await insert_into_dynamo(insertIntoGlobalPovTableParams);
            return { status: 200, message: "POV created successfully and sent for approval", pov_id: pov_creation_input_by_curator.Item.pov_id }
        }

    }
    else {
        return { status: "Error", Message: "Internal server error" };
    }
}

async function list_users_pov(event) {
    const input = {
        TableName: "tl_user_pov_drafts"
    }
    const result = await scan_dynamo(input);
    return {
        items: result.Items,
        totalCount: result.Count
    };
}

async function update_user_pov_status(event) {
    console.log(event);
    const check_bms_user_exists = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id = :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    const userdetails = await query_dynamo(check_bms_user_exists);
    if (userdetails.Count > 0) {
        // const updateStatus = {
        //     TableName: "tl_user_pov_drafts",
        //     Key: {
        //         pov_id: event.pov_id
        //     },
        //     UpdateExpression: " SET pov_status = :pov_status",
        //     ExpressionAttributeValues: {
        //         ":pov_status": event.pov_status
        //     },
        //     ReturnValues: "ALL_NEW"
        // }
        // await update_dynamo(updateStatus);
        if (event.pov_status === "APPROVED") {
            const updateInGlobalTable = {
                TableName: "tl_global_pov",
                Key: {
                    pov_id: event.pov_id
                },
                UpdateExpression: " SET pov_status = :pov_status",
                ExpressionAttributeValues: {
                    ":pov_status": "APPROVED"
                },
                // ReturnValues: "ALL_NEW"
            }
            const updateGlobalTable = await update_dynamo(updateInGlobalTable);
            // return { status: 200, data: updateGlobalTable.Items };

            if (updateGlobalTable === "SUCCESS") {
                const deleteDrafts = {
                    TableName: "tl_user_pov_drafts",
                    Key: {
                        pov_id: event.pov_id
                    }
                }
                let del = await delete_dynamo(deleteDrafts);
                console.log(del);
                return { Status: "Success", Message: "Pov approved!" };
            }

        }

        if (event.pov_status === 'REJECTED') {
            const deleterejectedPovs = {
                TableName: "tl_user_pov_drafts",
                Key: {
                    pov_id: event.pov_id
                }

            }
            let result = await delete_dynamo(deleterejectedPovs);
            if (result === "SUCCESS") {
                const deleteFromGlobalPovParams = {
                    TableName: "tl_global_pov",
                    Key: {
                        pov_id: event.pov_id
                    }
                }

                let result = await delete_dynamo(deleteFromGlobalPovParams);
                console.log(result);
                return { Status: "Success", Message: "POV rejected and deleted successfully!" }
            }
        }
        else {
            return "Invalid Operation";
        }
    }

}

async function list_global_pov(event) {
    const input = {

        TableName: "tl_global_pov",
        // ProjectionExpression:" pov_id",
        FilterExpression: "pov_status = :pov_status",
        ExpressionAttributeValues: {
            ":pov_status": "APPROVED"
        }
    }
    const result = await scan_dynamo(input);
    // console.log("result:", result)
    return {
        items: result.Items,
        totalCount: result.Count
    };
}

async function create_post(event) {
    console.log("Create POST:", event)
    let checkPovExists = {
        TableName: "tl_global_pov",
        KeyConditionExpression: "pov_id= :pov_id",
        ExpressionAttributeValues: {
            ":pov_id": event.pov_id
        }
    }

    const povDetails = await query_dynamo(checkPovExists);
    if (povDetails.Count == 0) {
        return { message: "POV does not exist!" };
    }
    if (povDetails.Count > 0 && povDetails.Items[0].creator_user_type === "ADMIN") {

        const postTableInsert = {
            TableName: "pov_public_post_table",
            Item: {
                post_id: uuidv4(),
                pov_id: povDetails.Items[0].pov_id,
                post_url: event.post_url
            }
        }

        let upload = await insert_into_dynamo(postTableInsert);

        if (upload === "SUCCESS") {
            const uploadPost = {
                TableName: "tl_global_pov",
                Key: {
                    pov_id: povDetails.Items[0].pov_id
                },
                UpdateExpression: 'SET post_url = list_append(post_url, :post_url)',
                ExpressionAttributeValues: {
                    ':post_url': [postTableInsert.Item.post_url],
                }
            }

            await update_dynamo(uploadPost);


            return { Status: 200, Message: "Post created successfully!" }
        }

        // return { Status: 200, Message: "Post uploaded successfully!" };
    }
    if (povDetails.Count > 0 && povDetails.Items[0].creator_user_type === "POV_CURATOR" || "ADMIN") {

        const postTableInsertParams = {
            TableName: "pov_public_post_table",
            Item: {
                post_id: uuidv4(),
                pov_id: povDetails.Items[0].pov_id,
                post_url: event.post_url,
                created_by: povDetails.Items[0].creator_user_type
            }
        }

        let uploadPosts = await insert_into_dynamo(postTableInsertParams);

        if (uploadPosts === "SUCCESS") {
            const uploadPostIntoGlobalTable = {
                TableName: "tl_global_pov",
                Key: {
                    pov_id: povDetails.Items[0].pov_id
                },
                UpdateExpression: 'SET post_url = list_append(post_url, :post_url)',
                ExpressionAttributeValues: {
                    ':post_url': [postTableInsertParams.Item.post_url],
                }
            }


            let result = await update_dynamo(uploadPostIntoGlobalTable);
            if (result === "SUCCESS") {
                const inputParams = {
                    TableName: "tl_pov_curator_drafts",
                    Key: {
                        pov_id: povDetails.Items[0].pov_id
                    },
                    UpdateExpression: 'SET post_url = list_append(post_url, :post_url)',
                    ExpressionAttributeValues: {
                        ':post_url': [postTableInsertParams.Item.post_url],
                    }
                }

                await update_dynamo(inputParams);
                return { Status: 200, Message: "Post created successfully!" }
            }



        }

        // return { Status: 200, Message: "Post uploaded successfully!" };

    }
}

async function delete_admin(event) {
    let adminExists = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id = :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }

    const adminDetails = await query_dynamo(adminExists);
    if (adminDetails.Count > 0 && adminDetails.Items[0].user_type === "ADMIN") {
        let deleteAdminExists = {
            TableName: "tl_admin",
            IndexName: "admin_email-admin_status-index",
            KeyConditionExpression: "admin_email = :admin_email and admin_status = :admin_status",
            ExpressionAttributeValues: {
                ":admin_email": event.admin_email,
                ":admin_status": "ACTIVE" || "DEACTIVATED"
            }
        }

        let deleteAdminDetails = await query_dynamo(deleteAdminExists);
        if (deleteAdminDetails.Count > 0) {
            let res = await delete_cognito_user(event.admin_email, process.env.admin_pool_id);
            if (res === "Success") {
                let deleteParams = {
                    TableName: "tl_admin",
                    Key: {
                        admin_id: deleteAdminDetails.Items[0].admin_id
                    }
                }
                await delete_dynamo(deleteParams);
                return { Status: 200, Message: "Admin deleted successfully" };
            }
            return { Message: `No admin with ${event.admin_email} found!` };
        }
    }
    return { Message: "Admin does not exist!" };
}

async function pov_deletion(event) {
    try {
        let checkPovExists = {
            TableName: "tl_global_pov",
            KeyConditionExpression: "pov_id = :pov_id",
            ExpressionAttributeValues: {
                ":pov_id": event.pov_id
            }
        };

        let povExistsDetails = await query_dynamo(checkPovExists);

        if (povExistsDetails.Count > 0) {
            const deleteParams = {
                TableName: "tl_global_pov",
                Key: {
                    pov_id: povExistsDetails.Items[0].pov_id
                }
            };

            let deletion = await delete_dynamo(deleteParams);

            if (deletion !== "SUCCESS") {
                throw new Error("Failed to delete POV");
            }

            const postsDeletionParams = {
                TableName: "pov_public_post_table",
                IndexName: "pov_id-index",
                KeyConditionExpression: "pov_id = :pov_id",
                ExpressionAttributeValues: {
                    ":pov_id": povExistsDetails.Items[0].pov_id
                }
            };

            const povExists = await query_dynamo(postsDeletionParams);

            if (povExists.Count > 0) {
                for (const post of povExists.Items) {
                    const deletePostParams = {
                        TableName: "pov_public_post_table",
                        Key: {
                            post_id: post.post_id
                        }
                    };
                    await delete_dynamo(deletePostParams);
                }
                return { Status: 200, Message: "Deleted successfully!!" };
            }
            else {
                throw new Error("No posts found for the given POV");
            }
        }
    }
    catch (error) {
        console.error("Error in POV deletion:", error);
        return { Status: 500, Message: "Internal Server Error" };
    }
}

async function list_global_posts(event) {
    const input = {
        TableName: "tl_global_pov",
        KeyConditionExpression: "pov_id = :pov_id",
        ExpressionAttributeValues: {
            ":pov_id": event.pov_id
        }
    }
    const povDetails = await query_dynamo(input);
    if (povDetails.Count > 0) {
        const postsUrl = povDetails.Items[0].post_url;
        return { Status: 200, data: postsUrl }
    }
    return { Message: `No Pov with ${event.pov_id} found!` }
}

async function edit_global_povs(event) {
    try {

        if (!event || !event.pov_id) {
            throw new Error("Invalid input. 'pov_id' is required.");
        }

        const checkPovExists = {
            TableName: "tl_global_pov",
            KeyConditionExpression: "pov_id = :pov_id",
            ExpressionAttributeValues: {
                ":pov_id": event.pov_id
            }
        }

        const result = await query_dynamo(checkPovExists);

        if (result.Count > 0) {
            let updateExpression = "SET ";
            let expressionAttributeValues = {};


            if (event.pov_name !== undefined) {
                updateExpression += "pov_name = :pov_name, ";
                expressionAttributeValues[":pov_name"] = event.pov_name;
            }
            if (event.pov_description !== undefined) {
                updateExpression += "pov_description = :pov_description, ";
                expressionAttributeValues[":pov_description"] = event.pov_description;
            }
            if (event.pov_latitude !== undefined) {
                updateExpression += "pov_latitude = :pov_latitude, ";
                expressionAttributeValues[":pov_latitude"] = event.pov_latitude;
            }
            if (event.pov_longitude !== undefined) {
                updateExpression += "pov_longitude = :pov_longitude, ";
                expressionAttributeValues[":pov_longitude"] = event.pov_longitude;
            }


            updateExpression = updateExpression.slice(0, -2);

            let updatePovParams = {
                TableName: "tl_global_pov",
                Key: {
                    pov_id: result.Items[0].pov_id
                },
                UpdateExpression: updateExpression,
                ExpressionAttributeValues: expressionAttributeValues
            };

            await update_dynamo(updatePovParams);
            return { status: 200, message: "Successfully Updated!" }
        }
        else {
            return { Message: "POV not found!" };
        }
    }
    catch (error) {
        console.error("An error occurred:", error);
        throw error; // Rethrow the error for Lambda to handle
    }
}

async function delete_post(event) {
    try {
        if (!event || !event.pov_id || !event.post_url) {
            throw new Error("Invalid input. 'pov_id' and 'post_url' are required.");
        }

        const checkPovExists = {
            TableName: "tl_global_pov",
            KeyConditionExpression: "pov_id = :pov_id",
            ExpressionAttributeValues: {
                ":pov_id": event.pov_id
            }
        }

        const result = await query_dynamo(checkPovExists);

        if (result.Count > 0) {
            const existingPostUrls = result.Items[0].post_url || [];

            const updatedPostUrls = existingPostUrls.filter(url => url !== event.post_url);

            const updatePovParams = {
                TableName: "tl_global_pov",
                Key: {
                    pov_id: result.Items[0].pov_id
                },
                UpdateExpression: "SET post_url = :post_url",
                ExpressionAttributeValues: {
                    ":post_url": updatedPostUrls
                }
            };

            const resposne = await update_dynamo(updatePovParams);
            if (resposne === "SUCCESS") {
                const deleteFromPostTableParams = {
                    TableName: "pov_public_post_table",
                    IndexName: "post_url-index",
                    KeyConditionExpression: "post_url= :post_url",
                    ExpressionAttributeValues: {
                        ":post_url": event.post_url
                    }
                }
                const postExists = await query_dynamo(deleteFromPostTableParams);
                if (postExists.Count > 0) {
                    let deleteParams = {
                        TableName: "pov_public_post_table",
                        Key: {
                            post_id: postExists.Items[0].post_id
                        }
                    }
                    await delete_dynamo(deleteParams);
                    return { status: 200, message: "Deleted Successfully !" }
                }
            }
        }
        else {
            return { Message: "POV not found!" };
        }
    }
    catch (error) {
        console.error("An error occurred:", error);
        throw error; // Rethrow the error for Lambda to handle
    }
}

async function update_curator_pov_status(event) {
    console.log(event);
    const check_bms_user_exists = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id = :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    const userdetails = await query_dynamo(check_bms_user_exists);
    if (userdetails.Count > 0 && userdetails.Items[0].user_type === "ADMIN") {
        if (event.pov_status === "APPROVED") {
            const updateInGlobalTable = {
                TableName: "tl_global_pov",
                Key: {
                    pov_id: event.pov_id
                },
                UpdateExpression: " SET pov_status = :pov_status",
                ExpressionAttributeValues: {
                    ":pov_status": "APPROVED"
                },

            }
            const updateGlobalTable = await update_dynamo(updateInGlobalTable);

            if (updateGlobalTable === "SUCCESS") {
                const deleteDrafts = {
                    TableName: "tl_pov_curator_drafts",
                    Key: {
                        pov_id: event.pov_id
                    }
                }
                let del = await delete_dynamo(deleteDrafts);
                console.log(del);
                return { Status: "Success", Message: "Pov approved!" };
            }

        }

        if (event.pov_status === 'REJECTED') {
            const deleterejectedPovs = {
                TableName: "tl_pov_curator_drafts",
                Key: {
                    pov_id: event.pov_id
                }

            }
            let result = await delete_dynamo(deleterejectedPovs);
            if (result === "SUCCESS") {
                const deleteFromGlobalPovParams = {
                    TableName: "tl_global_pov",
                    Key: {
                        pov_id: event.pov_id
                    }
                }

                let result = await delete_dynamo(deleteFromGlobalPovParams);
                console.log(result);
                return { Status: "Success", Message: "POV rejected and deleted successfully!" }
            }
        }
        else {
            return "Invalid Operation";
        }
    }

}

async function list_my_pov(event) {
    try {
        let input = {
            TableName: "tl_global_pov",
            IndexName: "created_by-index",
            KeyConditionExpression: "created_by = :created_by",
            ExpressionAttributeValues: {
                ":created_by": event.admin_id
            }
        };

        let result = await query_dynamo(input);
        return {
            items: result.Items,
            totalCount: result.Count
        };
    }
    catch (error) {
        console.error("Error querying DynamoDB:", error);
        throw error;
    }
}

async function edit_pov_for_pov_curator(event) {
    console.log("EVENT", event)
    const checkPovExists = {
        TableName: "tl_global_pov",
        KeyConditionExpression: "pov_id= :pov_id",
        ExpressionAttributeValues: {
            ":pov_id": event.pov_id
        }
    };
    let povDetails = await query_dynamo(checkPovExists);

    if (povDetails.Count > 0 && povDetails.Items[0].pov_status === "PENDING") {
        let updateExpression = "SET ";
        let expressionAttributeValues = {};

        if (event.pov_name !== undefined) {
            updateExpression += "pov_name = :pov_name, ";
            expressionAttributeValues[":pov_name"] = event.pov_name;
        }

        if (event.pov_description !== undefined) {
            updateExpression += "pov_description = :pov_description, ";
            expressionAttributeValues[":pov_description"] = event.pov_description;
        }

        if (event.pov_latitude !== undefined) {
            updateExpression += "pov_latitude = :pov_latitude, ";
            expressionAttributeValues[":pov_latitude"] = event.pov_latitude;
        }

        if (event.pov_longitude !== undefined) {
            updateExpression += "pov_longitude = :pov_longitude, ";
            expressionAttributeValues[":pov_longitude"] = event.pov_longitude;
        }
        updateExpression += "pov_status = :pov_status, ";
        expressionAttributeValues[":pov_status"] = "PENDING";

        if (event.post_url !== undefined) {
            updateExpression += "post_url = :post_url, ";
            expressionAttributeValues[":post_url"] = event.post_url;
        }

        updateExpression = updateExpression.slice(0, -2);


        let updateParams = {
            TableName: "tl_global_pov",
            Key: {
                pov_id: povDetails.Items[0].pov_id
            },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues
        };
        const updation = await update_dynamo(updateParams);
        console.log("updation:", updation);
        if (updation === "SUCCESS") {
            let updateInDraftsTableParams = {
                TableName: "tl_pov_curator_drafts",
                Key: {
                    pov_id: povDetails.Items[0].pov_id
                },
                UpdateExpression: updateExpression,
                ExpressionAttributeValues: expressionAttributeValues
            };
            let res = await update_dynamo(updateInDraftsTableParams);
            if (res === 'SUCCESS') {
                return { status: 200, message: "Your edit is successful and POV has been sent for approval!" };
            }
            else {
                return { message: "Error in updating!" };
            }
        }
    }

    if (povDetails.Count > 0 && povDetails.Items[0].pov_status === "APPROVED") {
        let updateExpression = "SET ";
        let expressionAttributeValues = {};

        if (event.pov_name !== undefined) {
            updateExpression += "pov_name = :pov_name, ";
            expressionAttributeValues[":pov_name"] = event.pov_name;
        }

        if (event.pov_description !== undefined) {
            updateExpression += "pov_description = :pov_description, ";
            expressionAttributeValues[":pov_description"] = event.pov_description;
        }

        if (event.pov_latitude !== undefined) {
            updateExpression += "pov_latitude = :pov_latitude, ";
            expressionAttributeValues[":pov_latitude"] = event.pov_latitude;
        }

        if (event.pov_longitude !== undefined) {
            updateExpression += "pov_longitude = :pov_longitude, ";
            expressionAttributeValues[":pov_longitude"] = event.pov_longitude;
        }
        updateExpression += "pov_status = :pov_status, ";
        expressionAttributeValues[":pov_status"] = "PENDING";

        if (event.post_url !== undefined) {
            updateExpression += "post_url = :post_url, ";
            expressionAttributeValues[":post_url"] = event.post_url;
        }
        updateExpression = updateExpression.slice(0, -2);

        let updateApprovedPovParams = {
            TableName: "tl_global_pov",
            Key: {
                pov_id: povDetails.Items[0].pov_id
            },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues

        };
        let updateNewValues = await update_dynamo(updateApprovedPovParams);
        if (updateNewValues === "SUCCESS") {
            let checkIfPovIsExisting = {
                TableName: "tl_global_pov",
                KeyConditionExpression: "pov_id= :pov_id",
                ExpressionAttributeValues: {
                    ":pov_id": povDetails.Items[0].pov_id
                }
            }

            let details = await query_dynamo(checkIfPovIsExisting);
            if (details.Count > 0) {
                const insertIntoDrafts = {
                    TableName: "tl_pov_curator_drafts",
                    Item: {
                        pov_id: details.Items[0].pov_id,
                        pov_name: details.Items[0].pov_name,
                        pov_description: details.Items[0].pov_description,
                        pov_latitude: details.Items[0].pov_latitude,
                        pov_longitude: details.Items[0].pov_longitude,
                        pov_created_on: details.Items[0].pov_created_on,
                        creator_user_type: details.Items[0].creator_user_type,
                        creator_name: details.Items[0].creator_name,
                        pov_status: details.Items[0].pov_status,
                        post_url: details.Items[0].post_url
                    }
                }
                await insert_into_dynamo(insertIntoDrafts);
                return { status: 200, message: "Edit is successful and sent for approval!" }
            }

        }
    }
}

async function list_curators_pov(event) {
    const input = {
        TableName: "tl_pov_curator_drafts"
    }
    const result = await scan_dynamo(input);
    return {
        items: result.Items,
        totalCount: result.Count
    };
}

async function list_user_devices_details(event) {
    const input = {
        TableName: "user_device_details"
    }
    let res = await scan_dynamo(input);
    return {
        items: res.Items,
        totalCount: res.Count
    };
}

async function delete_post_for_pov_curator(event) {
    console.log("event:", event);
    try {
        if (!event || !event.pov_id || !event.post_url) {
            throw new Error("Invalid input. 'pov_id' and 'post_url' are required.");
        }

        const checkPovExistsParams = {
            TableName: "tl_global_pov",
            KeyConditionExpression: "pov_id= :pov_id",
            ExpressionAttributeValues: {
                ":pov_id": event.pov_id
            }
        };

        const result = await query_dynamo(checkPovExistsParams);
        console.log(result);

        if (result.Count == 0) {
            return { Message: "POV not found!" };
        }

        const existingPostUrls = result.Items[0].post_url || [];
        const updatedPostUrls = existingPostUrls.filter(url => url !== event.post_url);

        const updatePovParams = {
            TableName: "tl_global_pov",
            Key: {
                pov_id: event.pov_id
            },
            UpdateExpression: "SET post_url = :post_url",
            ExpressionAttributeValues: {
                ":post_url": updatedPostUrls
            }
        };

        const updatePovResponse = await update_dynamo(updatePovParams);
        console.log(updatePovResponse);

        if (updatePovResponse === "SUCCESS") {
            const deleteFromPostTableParams = {
                TableName: "pov_public_post_table",
                IndexName: "post_url-index",
                KeyConditionExpression: "post_url = :post_url",
                ExpressionAttributeValues: {
                    ":post_url": event.post_url
                }
            };

            const postExists = await query_dynamo(deleteFromPostTableParams);
            console.log(postExists);

            if (postExists.Count > 0) {
                const deleteParams = {
                    TableName: "pov_public_post_table",
                    Key: {
                        post_id: postExists.Items[0].post_id
                    }
                };

                const deletion = await delete_dynamo(deleteParams);

                if (deletion === "SUCCESS") {
                    const updateDraftsParams = {
                        TableName: "tl_pov_curator_drafts",
                        Key: {
                            pov_id: event.pov_id
                        },
                        UpdateExpression: "SET post_url = :post_url",
                        ExpressionAttributeValues: {
                            ":post_url": updatedPostUrls
                        }
                    };

                    await update_dynamo(updateDraftsParams);
                    return { status: 200, message: "Deleted Successfully!" };
                }
            }
        }

        throw new Error("An error occurred while processing the request.");
    }
    catch (error) {
        console.error("An error occurred:", error);
        throw error; // Rethrow the error for Lambda to handle
    }
}

async function pov_deletion_for_pov_curator(event) {
    try {
        let checkPovExists = {
            TableName: "tl_global_pov",
            KeyConditionExpression: "pov_id = :pov_id",
            ExpressionAttributeValues: {
                ":pov_id": event.pov_id
            }
        };

        let povExistsDetails = await query_dynamo(checkPovExists);

        if (povExistsDetails.Count > 0) {
            const deleteParams = {
                TableName: "tl_global_pov",
                Key: {
                    pov_id: povExistsDetails.Items[0].pov_id
                }
            };

            let deletion = await delete_dynamo(deleteParams);

            if (deletion !== "SUCCESS") {
                throw new Error("Failed to delete POV");
            }

            let checkPovExistsInDrafts = {
                TableName: "tl_pov_curator_drafts",
                KeyConditionExpression: "pov_id= :pov_id",
                ExpressionAttributeValues: {
                    ":pov_id": povExistsDetails.Items[0].pov_id
                }
            }
            let draftExistence = await query_dynamo(checkPovExistsInDrafts);
            if (draftExistence.Count > 0) {
                const deleteFromDrafts = {
                    TableName: "tl_pov_curator_drafts",
                    Key: {
                        pov_id: povExistsDetails.Items[0].pov_id
                    }
                }
                await delete_dynamo(deleteFromDrafts);
            }


            const postsDeletionParams = {
                TableName: "pov_public_post_table",
                IndexName: "pov_id-index",
                KeyConditionExpression: "pov_id = :pov_id",
                ExpressionAttributeValues: {
                    ":pov_id": povExistsDetails.Items[0].pov_id
                }
            };

            const povExists = await query_dynamo(postsDeletionParams);

            if (povExists.Count > 0) {
                for (const post of povExists.Items) {
                    const deletePostParams = {
                        TableName: "pov_public_post_table",
                        Key: {
                            post_id: post.post_id
                        }
                    };
                    await delete_dynamo(deletePostParams);
                }
                return { Status: 200, Message: "Deleted successfully!!" };
            }



            else {
                throw new Error("No posts found for the given POV");
            }
        }
    }
    catch (error) {
        console.error("Error in POV deletion:", error);
        return { Status: 500, Message: "Internal Server Error" };
    }
}

/************************************ RESTAURANT ********************************************/

async function create_restaurant(event) {
    console.log(event);
    const ifAdminExists = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    const details = await query_dynamo(ifAdminExists);
    if (details.Count > 0 && details.Items[0].user_type === "RESTAURANT_CURATOR") {


        const creationParams = {
            TableName: "tl_restaurant_table",
            Item: {
                restaurant_id: uuidv4(),
                restaurant_name: event.restaurant_name,
                about: event.about,
                post_url: [],
                restaurant_latitude: event.restaurant_latitude,
                restaurant_longitude: event.restaurant_longitude,
                created_on: Date.now(),
                restaurant_status: "PENDING",
                created_by: details.Items[0].admin_name,
                creator_id: details.Items[0].admin_id
            }
        }

        let insertionParams = await insert_into_dynamo(creationParams);
        // if (insertionParams === 'SUCCESS') {
        //     const draftParams = {
        //         TableName: "tl_restaurant_drafts",
        //         Item: {
        //             restaurant_id: creationParams.Item.restaurant_id,
        //             restaurant_name: creationParams.Item.restaurant_name,
        //             about: creationParams.Item.about,
        //             post_url: [],
        //             created_on: creationParams.Item.created_on,
        //             created_by: details.Items[0].admin_name,
        //             restaurant_latitude: creationParams.Item.restaurant_latitude,
        //             restaurant_longitude: creationParams.Item.restaurant_longitude,
        //             creator_id: creationParams.Items[0].creator_id,
        //             restaurant_status: 'PENDING'
        //         }
        //     }
        //     await insert_into_dynamo(draftParams);
        //     return { status: 200, message: "restaurant created successfully and sent for approval!", restaurant_id: draftParams.Item.restaurant_id };
        // }
        return { status: 200, message: "Restaurant created successfully and sent for approval!", restaurant_id: creationParams.Item.restaurant_id };

    }
    if (details.Count > 0 && details.Items[0].user_type === "ADMIN") {
        let insertionParams = {
            TableName: "tl_restaurant_table",
            Item: {
                restaurant_id: uuidv4(),
                restaurant_name: event.restaurant_name,
                about: event.about,
                post_url: [],
                restaurant_latitude: event.restaurant_latitude,
                restaurant_longitude: event.restaurant_longitude,
                created_on: Date.now(),
                restaurant_status: "APPROVED",
                created_by: details.Items[0].admin_name,
                creator_id: details.Items[0].admin_id
            }
        }
        await insert_into_dynamo(insertionParams);
        return { status: 200, message: "Restaurant created successfully!", restaurant_id: insertionParams.Item.restaurant_id }
    }


    else {
        return { status: 404, message: "Only admins are authorized to do this operation!" }
    }
}

async function create_post_for_restaurant(event) {
    console.log(event);
    let adminTypeCheckParams = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    let adminDetails = await query_dynamo(adminTypeCheckParams);
    if (adminDetails.Count > 0 && adminDetails.Items[0].user_type === 'ADMIN') {

        let checkIfRestaurantExists = {
            TableName: "tl_restaurant_table",
            KeyConditionExpression: "restaurant_id= :restaurant_id",
            ExpressionAttributeValues: {
                ":restaurant_id": event.restaurant_id
            }
        }
        let details = await query_dynamo(checkIfRestaurantExists);
        if (details.Count > 0) {
            let createPostParams = {
                TableName: "tl_restaurant_posts",
                Item: {
                    post_id: uuidv4(),
                    post_url: event.post_url,
                    restaurant_id: details.Items[0].restaurant_id
                }
            }
            let createPost = await insert_into_dynamo(createPostParams);
            if (createPost === 'SUCCESS') {

                let creationParams = {
                    TableName: "tl_restaurant_table",
                    Key: {
                        restaurant_id: details.Items[0].restaurant_id
                    },
                    UpdateExpression: "SET post_url = list_append(post_url, :post_url)",
                    ExpressionAttributeValues: {
                        ":post_url": [createPostParams.Item.post_url]
                    }
                }
                await update_dynamo(creationParams);
                return { status: 200, message: "Post created successfully" };
            }
        }
    }
    if (adminDetails.Count > 0 && adminDetails.Items[0].user_type === 'RESTAURANT_CURATOR') {
        let checkIfRestaurantExists = {
            TableName: "tl_restaurant_table",
            KeyConditionExpression: "restaurant_id= :restaurant_id",
            ExpressionAttributeValues: {
                ":restaurant_id": event.restaurant_id
            }
        }
        let details = await query_dynamo(checkIfRestaurantExists);
        if (details.Count > 0 && details.Items[0].restaurant_status === 'PENDING') {
            let createPostParams = {
                TableName: "tl_restaurant_posts",
                Item: {
                    post_id: uuidv4(),
                    post_url: event.post_url,
                    restaurant_id: details.Items[0].restaurant_id
                }
            }
            let createPost = await insert_into_dynamo(createPostParams);
            if (createPost === 'SUCCESS') {

                let creationParams = {
                    TableName: "tl_restaurant_table",
                    Key: {
                        restaurant_id: details.Items[0].restaurant_id
                    },
                    UpdateExpression: "SET post_url = list_append(post_url, :post_url)",
                    ExpressionAttributeValues: {
                        ":post_url": [createPostParams.Item.post_url]
                    }
                }
                await update_dynamo(creationParams);
                return { status: 200, message: "Post created successfully" };
            }
        }

        if (details.Count > 0 && details.Items[0].restaurant_status === 'APPROVED') {
            let createPostParams = {
                TableName: "tl_restaurant_posts",
                Item: {
                    post_id: uuidv4(),
                    post_url: event.post_url,
                    restaurant_id: details.Items[0].restaurant_id
                }
            }
            let createPost = await insert_into_dynamo(createPostParams);
            if (createPost === 'SUCCESS') {

                let creationParams = {
                    TableName: "tl_restaurant_table",
                    Key: {
                        restaurant_id: details.Items[0].restaurant_id
                    },
                    UpdateExpression: "SET post_url = list_append(post_url, :post_url)",
                    ExpressionAttributeValues: {
                        ":post_url": [createPostParams.Item.post_url]
                    }
                }
                let creations = await update_dynamo(creationParams);
                if (creations === 'SUCCESS') {
                    let updateStatusParams = {
                        TableName: "tl_restaurant_table",
                        Key: {
                            restaurant_id: details.Items[0].restaurant_id
                        },
                        UpdateExpression: "SET restaurant_status= :restaurant_status",
                        ExpressionAttributeValues: {
                            ":restaurant_status": "PENDING"
                        }
                    }
                    await update_dynamo(updateStatusParams);

                    return { status: 200, message: "Post edit is successful and sent for approval!" };
                }
            }
        }
    }
}

async function delete_post_for_restaurant(event) {
    console.log(event);
    const checkAdminParams = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    let adminDetails = await query_dynamo(checkAdminParams);
    if (adminDetails.Count > 0 && adminDetails.Items[0].user_type === 'ADMIN') {
        let checkRestaurantExists = {
            TableName: "tl_restaurant_table",
            KeyConditionExpression: "restaurant_id= :restaurant_id",
            ExpressionAttributeValues: {
                ":restaurant_id": event.restaurant_id
            }
        }
        let details = await query_dynamo(checkRestaurantExists);
        if (details.Count > 0) {
            const existingPostUrls = details.Items[0].post_url || [];
            const post_url = event.post_url
            const updatedPostUrls = existingPostUrls.filter(url => url !== post_url);
            let updatePostUrls = {
                TableName: "tl_restaurant_table",
                Key: {
                    restaurant_id: details.Items[0].restaurant_id
                },
                UpdateExpression: "SET post_url= :post_url",
                ExpressionAttributeValues: {
                    ":post_url": updatedPostUrls
                }
            }
            let result = await update_dynamo(updatePostUrls);
            if (result === 'SUCCESS') {
                const postExists = {
                    TableName: "tl_restaurant_posts",
                    IndexName: "post_url-index",
                    KeyConditionExpression: "post_url = :post_url",
                    ExpressionAttributeValues: {
                        ":post_url": post_url
                    }
                }
                const exists = await query_dynamo(postExists);
                if (exists.Count > 0) {
                    const deleteParams = {
                        TableName: "tl_restaurant_posts",
                        Key: {
                            post_id: exists.Items[0].post_id
                        }
                    }
                    await delete_dynamo(deleteParams);
                    return { status: 200, message: "Deleted successfully!" };
                }

            }

        }
    }

    if (adminDetails.Count > 0 && adminDetails.Items[0].user_type === 'RESTAURANT_CURATOR') {
        let checkRestaurantExists = {
            TableName: "tl_restaurant_table",
            KeyConditionExpression: "restaurant_id= :restaurant_id",
            ExpressionAttributeValues: {
                ":restaurant_id": event.restaurant_id
            }
        }
        let details = await query_dynamo(checkRestaurantExists);
        if (details.Count > 0 && details.Items[0].restaurant_status === 'PENDING') {
            const existingPostUrls = details.Items[0].post_url || [];
            const post_url = event.post_url
            const updatedPostUrls = existingPostUrls.filter(url => url !== post_url);
            let updatePostUrls = {
                TableName: "tl_restaurant_table",
                Key: {
                    restaurant_id: details.Items[0].restaurant_id
                },
                UpdateExpression: "SET post_url= :post_url",
                ExpressionAttributeValues: {
                    ":post_url": updatedPostUrls
                }
            }
            const result = await update_dynamo(updatePostUrls);
            if (result === 'SUCCESS') {
                const postExists = {
                    TableName: "tl_restaurant_posts",
                    IndexName: "post_url-index",
                    KeyConditionExpression: "post_url = :post_url",
                    ExpressionAttributeValues: {
                        ":post_url": post_url
                    }
                }
                const exists = await query_dynamo(postExists);
                if (exists.Count > 0) {
                    const deleteParams = {
                        TableName: "tl_restaurant_posts",
                        Key: {
                            post_id: exists.Items[0].post_id
                        }
                    }
                    await delete_dynamo(deleteParams);
                    return { status: 200, message: "Edited successfully!" };
                }
            }
        }

        if (details.Count > 0 && details.Items[0].restaurant_status === 'APPROVED') {
            const existingPostUrls = details.Items[0].post_url || [];
            const post_url = event.post_url
            const updatedPostUrls = existingPostUrls.filter(url => url !== post_url);
            let updatePostUrls = {
                TableName: "tl_restaurant_table",
                Key: {
                    restaurant_id: details.Items[0].restaurant_id
                },
                UpdateExpression: "SET post_url= :post_url",
                ExpressionAttributeValues: {
                    ":post_url": updatedPostUrls
                }
            }
            let updation = await update_dynamo(updatePostUrls);
            if (updation === "SUCCESS") {
                let updateStatusParams = {
                    TableName: "tl_restaurant_table",
                    Key: {
                        restaurant_id: details.Items[0].restaurant_id
                    },
                    UpdateExpression: "SET restaurant_status= :restaurant_status",
                    ExpressionAttributeValues: {
                        ":restaurant_status": "PENDING"
                    }
                }
                const result = await update_dynamo(updateStatusParams);
                if (result === 'SUCCESS') {
                    const postExists = {
                        TableName: "tl_restaurant_posts",
                        IndexName: "post_url-index",
                        KeyConditionExpression: "post_url = :post_url",
                        ExpressionAttributeValues: {
                            ":post_url": post_url
                        }
                    }
                    const exists = await query_dynamo(postExists);
                    if (exists.Count > 0) {
                        const deleteParams = {
                            TableName: "tl_restaurant_posts",
                            Key: {
                                post_id: exists.Items[0].post_id
                            }
                        }
                        await delete_dynamo(deleteParams);

                        return { status: 200, message: "Edit is successful and sent for approval!" }
                    }
                }
            }



        }

    }
}

// async function upload_menu_images(event) {
//     console.log(event)

//     const checkRestaurantExists = {
//         TableName: "tl_restaurant_table",
//         KeyConditionExpression: "restaurant_id= :restaurant_id",
//         ExpressionAttributeValues: {
//             ":restaurant_id": event.restaurant_id
//         }
//     }

//     let restaurantExists = await query_dynamo(checkRestaurantExists);
//     if (restaurantExists.Count > 0) {
//         let createPostParams = {
//             TableName: "tl_restaurant_menu_images",
//             Item: {
//                 menu_id: uuidv4(),
//                 menu_url: event.menu_url,
//                 created_by: restaurantExists.Items[0].restaurant_id,
//                 restaurant_name: restaurantExists.Items[0].restaurant_name,
//                 created_on: Date.now()
//             }
//         }
//         const createPosts = await insert_into_dynamo(createPostParams);
//         if (createPosts === "SUCCESS") {
//             const insertIntoMainTable = {
//                 TableName: "tl_restaurant_table",
//                 Key: {
//                     restaurant_id: restaurantExists.Items[0].restaurant_id
//                 },
//                 UpdateExpression: "SET menu_url = list_append(menu_url, :menu_url)",
//                 ExpressionAttributeValues: {
//                     ":menu_url": [createPostParams.Item.menu_url]
//                 }
//             }
//             let mainTableUpdation = await update_dynamo(insertIntoMainTable);
//             if (mainTableUpdation === 'SUCCESS') {
//                 let insertIntoDraftsTable = {
//                     TableName: "tl_restaurant_drafts",
//                     Key: {
//                         restaurant_id: restaurantExists.Items[0].restaurant_id
//                     },
//                     UpdateExpression: "SET menu_url = list_append(menu_url, :menu_url)",
//                     ExpressionAttributeValues: {
//                         ":menu_url": [createPostParams.Item.menu_url]
//                     }
//                 }
//                 await update_dynamo(insertIntoDraftsTable)
//                 return { status: 200, message: "Images uploaded successfully!" }
//             }

//         }
//     }
// }

// async function upload_food_images(event) {
//     console.log(event)

//     const checkRestaurantExists = {
//         TableName: "tl_restaurant_table",
//         KeyConditionExpression: "restaurant_id= :restaurant_id",
//         ExpressionAttributeValues: {
//             ":restaurant_id": event.restaurant_id
//         }
//     }

//     let restaurantExists = await query_dynamo(checkRestaurantExists);
//     if (restaurantExists.Count > 0) {
//         let createPostParams = {
//             TableName: "tl_restaurant_food_images",
//             Item: {
//                 food_id: uuidv4(),
//                 food_url: event.food_url,
//                 created_by: restaurantExists.Items[0].restaurant_id,
//                 restaurant_name: restaurantExists.Items[0].restaurant_name,
//                 created_on: Date.now()
//             }
//         }
//         const createPosts = await insert_into_dynamo(createPostParams);
//         if (createPosts === "SUCCESS") {
//             const insertIntoMainTable = {
//                 TableName: "tl_restaurant_table",
//                 Key: {
//                     restaurant_id: restaurantExists.Items[0].restaurant_id
//                 },
//                 UpdateExpression: "SET food_url = list_append(food_url, :food_url)",
//                 ExpressionAttributeValues: {
//                     ":food_url": [createPostParams.Item.food_url]
//                 }
//             }
//             let mainTableUpdation = await update_dynamo(insertIntoMainTable);
//             if (mainTableUpdation === 'SUCCESS') {
//                 let insertIntoDrafts = {
//                     TableName: "tl_restaurant_drafts",
//                     Key: {
//                         restaurant_id: restaurantExists.Items[0].restaurant_id

//                     },
//                     UpdateExpression: "SET food_url = list_append(food_url, :food_url)",
//                     ExpressionAttributeValues: {
//                         ":food_url": [createPostParams.Item.food_url]
//                     }
//                 }
//                 await update_dynamo(insertIntoDrafts);
//                 return { status: 200, message: "Images uploaded successfully!" }
//             }
//         }
//     }
// }

// async function upload_ambience_images(event) {
//     console.log(event)
//     const checkRestaurantExists = {
//         TableName: "tl_restaurant_table",
//         KeyConditionExpression: "restaurant_id= :restaurant_id",
//         ExpressionAttributeValues: {
//             ":restaurant_id": event.restaurant_id
//         }
//     }

//     let restaurantExists = await query_dynamo(checkRestaurantExists);
//     if (restaurantExists.Count > 0) {
//         let createPostParams = {
//             TableName: "tl_restaurant_ambience_images",
//             Item: {
//                 ambience_id: uuidv4(),
//                 ambience_url: event.ambience_url,
//                 created_by: restaurantExists.Items[0].restaurant_id,
//                 restaurant_name: restaurantExists.Items[0].restaurant_name,
//                 created_on: Date.now()
//             }
//         }
//         const createPosts = await insert_into_dynamo(createPostParams);
//         if (createPosts === "SUCCESS") {
//             const insertIntoMainTable = {
//                 TableName: "tl_restaurant_table",
//                 Key: {
//                     restaurant_id: restaurantExists.Items[0].restaurant_id
//                 },
//                 UpdateExpression: "SET ambience_url = list_append(ambience_url, :ambience_url)",
//                 ExpressionAttributeValues: {
//                     ":ambience_url": [createPostParams.Item.ambience_url]
//                 }
//             }
//             let updateInMainTable = await update_dynamo(insertIntoMainTable);
//             if (updateInMainTable === 'SUCCESS') {
//                 let insertIntoDraftsTable = {
//                     TableName: "tl_restaurant_drafts",
//                     Key: {
//                         restaurant_id: restaurantExists.Items[0].restaurant_id
//                     },
//                     UpdateExpression: "SET ambience_url = list_append(ambience_url, :ambience_url)",
//                     ExpressionAttributeValues: {
//                         ":ambience_url": [createPostParams.Item.ambience_url]
//                     }
//                 }
//                 await update_dynamo(insertIntoDraftsTable);
//                 return { status: 200, message: "Images uploaded successfully!" }


//             }
//         }
//     }
// }

async function list_approved_restaurants(event) {
    const input = {
        TableName: "tl_restaurant_table",
        FilterExpression: "restaurant_status= :restaurant_status ",
        ExpressionAttributeValues: {
            ":restaurant_status": "APPROVED"
        }
    }
    const result = await scan_dynamo(input);
    return { status: 200, data: result.Items, totalCount: result.Count }
}

async function list_pending_restaurants(event) {
    const input = {
        TableName: "tl_restaurant_table",
        FilterExpression: "restaurant_status= :restaurant_status",
        ExpressionAttributeValues: {
            ":restaurant_status": "PENDING"
        }
    }
    const result = await scan_dynamo(input);
    return { status: 200, data: result.Items, totalCount: result.Count }
}

async function approve_or_reject_restaurant(event) {
    console.log(event);
    const checkAdminParams = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    let adminDetails = await query_dynamo(checkAdminParams);
    if (adminDetails.Count > 0 && adminDetails.Items[0].user_type === 'ADMIN') {
        let checkRestaurantExists = {
            TableName: "tl_restaurant_table",
            KeyConditionExpression: "restaurant_id= :restaurant_id",
            ExpressionAttributeValues: {
                ":restaurant_id": event.restaurant_id
            }
        }
        let restDetails = await query_dynamo(checkRestaurantExists);
        if (restDetails.count === 0) {
            return { message: "Restaurant does not exist!" };
        }
        if (restDetails.Count > 0) {
            if (event.restaurant_decision === 'APPROVE') {
                const approveParams = {
                    TableName: "tl_restaurant_table",
                    Key: {
                        restaurant_id: restDetails.Items[0].restaurant_id
                    },
                    UpdateExpression: "SET restaurant_status= :restaurant_status",
                    ExpressionAttributeValues: {
                        ":restaurant_status": "APPROVED"
                    }
                }
                await update_dynamo(approveParams);
                return { status: 200, message: "Restaurant approved successfully!" };
            }
            if (event.restaurant_decision === 'REJECT') {
                const deleteParams = {
                    TableName: "tl_restaurant_table",
                    Key: {
                        restaurant_id: restDetails.Items[0].restaurant_id
                    }

                }
                await delete_dynamo(deleteParams);
                return { status: 200, message: "Restaurant deleted successfully!" };
            }
        }
    }
    else {
        return { message: "Unauthorized operation!" };
    }
}

async function edit_restaurant(event) {
    const checkAdminParams = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    let adminDetails = await query_dynamo(checkAdminParams);
    if (adminDetails.Count > 0 && adminDetails.Items[0].user_type === 'ADMIN') {

        let updateExpression = "SET ";
        let expressionAttributeValues = {};

        if (event.restaurant_name !== undefined) {
            updateExpression += "restaurant_name = :restaurant_name, ";
            expressionAttributeValues[":restaurant_name"] = event.restaurant_name;
        }

        if (event.about !== undefined) {
            updateExpression += "about = :about, ";
            expressionAttributeValues[":about"] = event.about;
        }

        if (event.restaurant_latitude !== undefined) {
            updateExpression += "restaurant_latitude = :restaurant_latitude, ";
            expressionAttributeValues[":restaurant_latitude"] = event.restaurant_latitude;
        }

        if (event.restaurant_longitude !== undefined) {
            updateExpression += "restaurant_longitude = :restaurant_longitude, ";
            expressionAttributeValues[":restaurant_longitude"] = event.restaurant_longitude;
        }


        updateExpression += "restaurant_status = :restaurant_status, ";
        expressionAttributeValues[":restaurant_status"] = "APPROVED";


        updateExpression = updateExpression.slice(0, -2);
        const updateParams = {
            TableName: "tl_restaurant_table",
            Key: {
                restaurant_id: event.restaurant_id
            },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues
        }
        await update_dynamo(updateParams);
        return { status: 200, message: "Edit successful!" };

    }


    if (adminDetails.Count > 0 && adminDetails.Items[0].user_type === 'RESTAURANT_CURATOR') {
        let checkRestaurantExists = {
            TableName: "tl_restaurant_table",
            KeyConditionExpression: "restaurant_id= :restaurant_id",
            ExpressionAttributeValues: {
                ":restaurant_id": event.restaurant_id
            }
        }

        let restDetails = await query_dynamo(checkRestaurantExists);
        if (restDetails.Items[0].restaurant_status === 'PENDING' || "APPROVED") {
            let updateExpression = "SET ";
            let expressionAttributeValues = {};

            if (event.restaurant_name !== undefined) {
                updateExpression += "restaurant_name = :restaurant_name, ";
                expressionAttributeValues[":restaurant_name"] = event.restaurant_name;
            }

            if (event.about !== undefined) {
                updateExpression += "about = :about, ";
                expressionAttributeValues[":about"] = event.about;
            }

            if (event.restaurant_latitude !== undefined) {
                updateExpression += "restaurant_latitude = :restaurant_latitude, ";
                expressionAttributeValues[":restaurant_latitude"] = event.restaurant_latitude;
            }

            if (event.restaurant_longitude !== undefined) {
                updateExpression += "restaurant_longitude = :restaurant_longitude, ";
                expressionAttributeValues[":restaurant_longitude"] = event.restaurant_longitude;
            }


            updateExpression += "restaurant_status = :restaurant_status, ";
            expressionAttributeValues[":restaurant_status"] = "PENDING";


            updateExpression = updateExpression.slice(0, -2);
            const updateParams = {
                TableName: "tl_restaurant_table",
                Key: {
                    restaurant_id: event.restaurant_id
                },
                UpdateExpression: updateExpression,
                ExpressionAttributeValues: expressionAttributeValues
            }
            await update_dynamo(updateParams);
            return { status: 200, message: "Edit is successful and sent for approval!" };
        }

    }
}

// async function approve_restaurant(event) {
//     console.log("Approve restaurant:", event);
//     let checkIfAdminExists = {
//         TableName: "tl_admin",
//         KeyConditionExpression: "admin_id= :admin_id",
//         ExpressionAttributeValues: {
//             ":admin_id": event.admin_id
//         }
//     }

//     const adminExists = await query_dynamo(checkIfAdminExists);

//     if (adminExists.Count > 0 && adminExists.Items[0].user_type === "ADMIN") {
//         let checkIfRestaurantExists = {
//             TableName: "tl_restaurant_drafts",
//             KeyConditionExpression: "restaurant_id= :restaurant_id",
//             ExpressionAttributeValues: {
//                 ":restaurant_id": event.restaurant_id
//             }
//         }
//         const restaurantExists = await query_dynamo(checkIfRestaurantExists);
//         if (restaurantExists.Count > 0) {
//             if (event.restaurant_decision === "APPROVE") {
//                 const approveParams = {
//                     TableName: "tl_restaurant_table",
//                     Key: {
//                         restaurant_id: restaurantExists.Items[0].restaurant_id
//                     },
//                     UpdateExpression: "SET restaurant_status= :restaurant_status",
//                     ExpressionAttributeValues: {
//                         ":restaurant_status": "APPROVED"
//                     }
//                 }
//                 const updation = await update_dynamo(approveParams);
//                 if (updation === 'SUCCESS') {
//                     const deleteFromDrafts = {
//                         TableName: "tl_restaurant_drafts",
//                         Key: {
//                             restaurant_id: restaurantExists.Items[0].restaurant_id
//                         }
//                     }

//                     await delete_dynamo(deleteFromDrafts);
//                     return { status: 200, message: "Restaurant approved successfully!" }
//                 }
//             }
//             if (event.restaurant_decision === 'REJECT') {
//                 const deleteFromMainTableParams = {
//                     TableName: "tl_restaurant_table",
//                     key: {
//                         restaurant_id: restaurantExists.Items[0].restaurant_id

//                     }
//                 }

//                 const deletion = await delete_dynamo(deleteFromMainTableParams);

//                     return { status: 200, message: "Restaurant rejected successfully!" }

//             }
//         }
//         return { message: "No restaurants found!" };

//     }

//     return { status: 200, message: "Only admins are authorized to perform this operation" };

// }

// async function edit_restaurant(event) {
//     console.log("EVENT", event)

//     let checkIfAdminExists = {
//         TableName: "tl_admin",
//         KeyConditionExpression: "admin_id= :admin_id",
//         ExpressionAttributeValues: {
//             ":admin_id": event.admin_id
//         }
//     }
//     let adminDetails = await query_dynamo(checkIfAdminExists);
//     if (adminDetails.Count > 0) {
//         const checkRestaurantExists = {
//             TableName: "tl_restaurant_table",
//             KeyConditionExpression: "restaurant_id= :restaurant_id",
//             ExpressionAttributeValues: {
//                 ":restaurant_id": event.restaurant_id
//             }
//         };
//         let restaurantDetails = await query_dynamo(checkRestaurantExists);

//         if (restaurantDetails.Count == 0) {
//             throw new Error("Restaurant does not exist!");
//         }

//         if (restaurantDetails.Count > 0 && restaurantDetails.Items[0].restaurant_status === "PENDING") {
//             let updateExpression = "SET ";
//             let expressionAttributeValues = {};

//             if (event.restaurant_name !== undefined) {
//                 updateExpression += "restaurant_name = :restaurant_name, ";
//                 expressionAttributeValues[":restaurant_name"] = event.restaurant_name;
//             }

//             if (event.about !== undefined) {
//                 updateExpression += "about = :about, ";
//                 expressionAttributeValues[":about"] = event.about;
//             }

//             if (event.restaurant_latitude !== undefined) {
//                 updateExpression += "restaurant_latitude = :restaurant_latitude, ";
//                 expressionAttributeValues[":restaurant_latitude"] = event.restaurant_latitude;
//             }

//             if (event.restaurant_longitude !== undefined) {
//                 updateExpression += "restaurant_longitude = :restaurant_longitude, ";
//                 expressionAttributeValues[":restaurant_longitude"] = event.restaurant_longitude;
//             }

//             // if (event.menu_url !== undefined) {
//             //     updateExpression += "menu_url = :menu_url, ";
//             //     expressionAttributeValues[":menu_url"] = event.menu_url;
//             // }

//             // if (event.food_url !== undefined) {
//             //     updateExpression += "food_url = :food_url, ";
//             //     expressionAttributeValues[":food_url"] = event.food_url;
//             // }
//             // if (event.ambience_url !== undefined) {
//             //     updateExpression += "ambience_url = :ambience_url, ";
//             //     expressionAttributeValues[":ambience_url"] = event.ambience_url;
//             // }

//             updateExpression += "restaurant_status = :restaurant_status, ";
//             expressionAttributeValues[":restaurant_status"] = "PENDING";


//             updateExpression = updateExpression.slice(0, -2);


//             let updateParams = {
//                 TableName: "tl_restaurant_table",
//                 Key: {
//                     restaurant_id: restaurantDetails.Items[0].restaurant_id
//                 },
//                 UpdateExpression: updateExpression,
//                 ExpressionAttributeValues: expressionAttributeValues
//             };
//             const updation = await update_dynamo(updateParams);
//             console.log("updation:", updation);
//             if (updation === "SUCCESS") {
//                 let updateInDraftsTableParams = {
//                     TableName: "tl_restaurant_drafts",
//                     Key: {
//                         restaurant_id: restaurantDetails.Items[0].restaurant_id
//                     },
//                     UpdateExpression: updateExpression,
//                     ExpressionAttributeValues: expressionAttributeValues
//                 };
//                 let res = await update_dynamo(updateInDraftsTableParams);
//                 if (res === 'SUCCESS') {
//                     return { status: 200, message: "Your edit is successful and POV has been sent for approval!" };
//                 }
//                 else {
//                     return { message: "Error in updating!" };
//                 }
//             }
//         }

//         if (restaurantDetails.Count > 0 && restaurantDetails.Items[0].restaurant_status === "APPROVED" && adminDetails.Items[0].user_type === 'RESTAURANT_CURATOR ') {
//             let updateExpression = "SET ";
//             let expressionAttributeValues = {};

//             if (event.restaurant_name !== undefined) {
//                 updateExpression += "restaurant_name = :restaurant_name, ";
//                 expressionAttributeValues[":restaurant_name"] = event.restaurant_name;
//             }

//             if (event.about !== undefined) {
//                 updateExpression += "about = :about, ";
//                 expressionAttributeValues[":about"] = event.about;
//             }

//             if (event.restaurant_latitude !== undefined) {
//                 updateExpression += "restaurant_latitude = :restaurant_latitude, ";
//                 expressionAttributeValues[":restaurant_latitude"] = event.restaurant_latitude;
//             }

//             if (event.restaurant_longitude !== undefined) {
//                 updateExpression += "restaurant_longitude = :restaurant_longitude, ";
//                 expressionAttributeValues[":restaurant_longitude"] = event.restaurant_longitude;
//             }

//             // if (event.menu_url !== undefined) {
//             //     updateExpression += "menu_url = :menu_url, ";
//             //     expressionAttributeValues[":menu_url"] = event.menu_url;
//             // }

//             // if (event.food_url !== undefined) {
//             //     updateExpression += "food_url = :food_url, ";
//             //     expressionAttributeValues[":food_url"] = event.food_url;
//             // }
//             // if (event.ambience_url !== undefined) {
//             //     updateExpression += "ambience_url = :ambience_url, ";
//             //     expressionAttributeValues[":ambience_url"] = event.ambience_url;
//             // }

//             updateExpression += "restaurant_status = :restaurant_status, ";
//             expressionAttributeValues[":restaurant_status"] = "PENDING";


//             updateExpression = updateExpression.slice(0, -2);


//             let updateApprovedPovParams = {
//                 TableName: "tl_restaurant_table",
//                 Key: {
//                     restaurant_id: restaurantDetails.Items[0].restaurant_id
//                 },
//                 UpdateExpression: updateExpression,
//                 ExpressionAttributeValues: expressionAttributeValues

//             };
//             let updateNewValues = await update_dynamo(updateApprovedPovParams);
//             if (updateNewValues === "SUCCESS") {
//                 let checkIfPovIsExisting = {
//                     TableName: "tl_restaurant_table",
//                     KeyConditionExpression: "restaurant_id= :restaurant_id",
//                     ExpressionAttributeValues: {
//                         ":restaurant_id": restaurantDetails.Items[0].restaurant_id
//                     }
//                 }

//                 let details = await query_dynamo(checkIfPovIsExisting);
//                 if (details.Count > 0) {
//                     const insertIntoDrafts = {
//                         TableName: "tl_restaurant_drafts",
//                         Item: {
//                             restaurant_id: details.Items[0].restaurant_id,
//                             about: details.Items[0].about,
//                             restaurant_latitude: details.Items[0].restaurant_latitude,
//                             restaurant_longitude: details.Items[0].restaurant_longitude,
//                             created_on: details.Items[0].created_on,
//                             // creator_user_type: details.Items[0].creator_user_type,
//                             created_by: details.Items[0].created_by,
//                             restaurant_status: details.Items[0].restaurant_status,
//                             menu_url: details.Items[0].menu_url,
//                             food_url: details.Items[0].food_url,
//                             ambience_url: details.Items[0].ambience_url
//                         }
//                     }
//                     await insert_into_dynamo(insertIntoDrafts);
//                     return { status: 200, message: "Edit is successful and sent for approval!" }
//                 }
//             }
//         }

//         if (restaurantDetails.Count > 0 && restaurantDetails.Items[0].restaurant_status === "APPROVED" && adminDetails.Items[0].user_type === 'ADMIN') {
//             let updateExpression = "SET ";
//             let expressionAttributeValues = {};

//             if (event.restaurant_name !== undefined) {
//                 updateExpression += "restaurant_name = :restaurant_name, ";
//                 expressionAttributeValues[":restaurant_name"] = event.restaurant_name;
//             }

//             if (event.about !== undefined) {
//                 updateExpression += "about = :about, ";
//                 expressionAttributeValues[":about"] = event.about;
//             }

//             if (event.restaurant_latitude !== undefined) {
//                 updateExpression += "restaurant_latitude = :restaurant_latitude, ";
//                 expressionAttributeValues[":restaurant_latitude"] = event.restaurant_latitude;
//             }

//             if (event.restaurant_longitude !== undefined) {
//                 updateExpression += "restaurant_longitude = :restaurant_longitude, ";
//                 expressionAttributeValues[":restaurant_longitude"] = event.restaurant_longitude;
//             }

//             // if (event.menu_url !== undefined) {
//             //     updateExpression += "menu_url = :menu_url, ";
//             //     expressionAttributeValues[":menu_url"] = event.menu_url;
//             // }

//             // if (event.food_url !== undefined) {
//             //     updateExpression += "food_url = :food_url, ";
//             //     expressionAttributeValues[":food_url"] = event.food_url;
//             // }
//             // if (event.ambience_url !== undefined) {
//             //     updateExpression += "ambience_url = :ambience_url, ";
//             //     expressionAttributeValues[":ambience_url"] = event.ambience_url;
//             // }

//             updateExpression += "restaurant_status = :restaurant_status, ";
//             expressionAttributeValues[":restaurant_status"] = "APPROVED";


//             updateExpression = updateExpression.slice(0, -2);

//             const updateParams = {
//                 TableName: "tl_restaurant_table",
//                 Key: {
//                     restaurant_id: restaurantDetails.Items[0].restaurant_id
//                 },
//                 UpdateExpression: updateExpression,
//                 ExpressionAttributeValues: expressionAttributeValues
//             }
//             await update_dynamo(updateParams);
//             return { status: 200, message: "Edit successful!" }

//         }
//     }
//     else {
//         throw new Error("Admin does not exist!");
//     }
// }

// async function delete_menu_images_for_restaurant(event) {
//     console.log(event);
//     const checkIfRestaurantExists = {
//         TableName: "tl_restaurant_table",
//         KeyConditionExpression: "restaurant_id= :restaurant_id",
//         ExpressionAttributeValues: {
//             ":restaurant_id": event.restaurant_id
//         }
//     };
//     let details = await query_dynamo(checkIfRestaurantExists);
//     console.log(details);
//     if (details.Count > 0) {
//         let menuUrl = event.menu_url;
//         const existingMenuUrls = details.Items[0].menu_url || [];
//         const updatedMenuUrls = existingMenuUrls.filter(url => url !== menuUrl);

//         let updateTableParams = {
//             TableName: "tl_restaurant_table",
//             Key: {
//                 restaurant_id: details.Items[0].restaurant_id
//             },
//             UpdateExpression: "SET menu_url= :menu_url",
//             ExpressionAttributeValues: {
//                 ":menu_url": updatedMenuUrls
//             }
//         };

//         let updation = await update_dynamo(updateTableParams);
//         console.log(updation);
//         if (updation === 'SUCCESS') {
//             let updateInDraftsParams = {
//                 TableName: "tl_restaurant_drafts",
//                 Key: {
//                     restaurant_id: details.Items[0].restaurant_id
//                 },
//                 UpdateExpression: "SET menu_url= :menu_url",
//                 ExpressionAttributeValues: {
//                     ":menu_url": updatedMenuUrls
//                 }
//             };

//             let draftsUpdation = await update_dynamo(updateInDraftsParams);
//             if (draftsUpdation === 'SUCCESS') {
//                 let checkIfMenuUrlExists = {
//                     TableName: "tl_restaurant_menu_images",
//                     IndexName: "menu_url-index",
//                     KeyConditionExpression: "menu_url= :menu_url",
//                     ExpressionAttributeValues: {
//                         ":menu_url": menuUrl
//                     }
//                 };

//                 let checkMenuUrlExists = await query_dynamo(checkIfMenuUrlExists);
//                 console.log(checkMenuUrlExists);
//                 if (checkMenuUrlExists.Count > 0) {
//                     let deleteUrlParams = {
//                         TableName: "tl_restaurant_menu_images",
//                         Key: {
//                             menu_id: checkMenuUrlExists.Items[0].menu_id
//                         }
//                     };
//                     let deletion = await delete_dynamo(deleteUrlParams);
//                     return { status: 200, message: "Image deleted successfully!" };
//                 }
//                 else {
//                     return { message: "Invalid operation!" };
//                 }
//             }
//         }
//     }
// }

// async function delete_food_images_for_restaurant(event) {
//     console.log(event);
//     const checkIfRestaurantExists = {
//         TableName: "tl_restaurant_table",
//         KeyConditionExpression: "restaurant_id= :restaurant_id",
//         ExpressionAttributeValues: {
//             ":restaurant_id": event.restaurant_id
//         }
//     };
//     let details = await query_dynamo(checkIfRestaurantExists);
//     console.log(details);
//     if (details.Count > 0) {
//         let foodUrl = event.food_url;
//         const existingFoodUrls = details.Items[0].foodUrl || [];
//         const updatedFoodUrls = existingFoodUrls.filter(url => url !== foodUrl);

//         let updateTableParams = {
//             TableName: "tl_restaurant_table",
//             Key: {
//                 restaurant_id: details.Items[0].restaurant_id
//             },
//             UpdateExpression: "SET food_url= :food_url",
//             ExpressionAttributeValues: {
//                 ":food_url": updatedFoodUrls
//             }
//         };

//         let updation = await update_dynamo(updateTableParams);
//         console.log(updation);
//         if (updation === 'SUCCESS') {
//             let updateInDraftsParams = {
//                 TableName: "tl_restaurant_drafts",
//                 Key: {
//                     restaurant_id: details.Items[0].restaurant_id
//                 },
//                 UpdateExpression: "SET food_url= :food_url",
//                 ExpressionAttributeValues: {
//                     ":food_url": updatedFoodUrls
//                 }
//             };

//             let draftsUpdation = await update_dynamo(updateInDraftsParams);
//             if (draftsUpdation === 'SUCCESS') {
//                 let checkIfFoodUrlExists = {
//                     TableName: "tl_restaurant_food_images",
//                     IndexName: "food_url-index",
//                     KeyConditionExpression: "food_url= :food_url",
//                     ExpressionAttributeValues: {
//                         ":food_url": foodUrl
//                     }
//                 };

//                 let checkFoodUrlExists = await query_dynamo(checkIfFoodUrlExists);
//                 console.log(checkFoodUrlExists);
//                 if (checkFoodUrlExists.Count > 0) {
//                     let deleteUrlParams = {
//                         TableName: "tl_restaurant_food_images",
//                         Key: {
//                             food_id: checkFoodUrlExists.Items[0].food_id
//                         }
//                     };
//                     await delete_dynamo(deleteUrlParams);
//                     return { status: 200, message: "Image deleted successfully!" };
//                 }
//                 else {
//                     return { message: "Invalid operation!" };
//                 }
//             }
//         }
//     }
// }

// async function delete_ambience_images_for_restaurant(event) {
//     console.log(event);
//     const checkIfRestaurantExists = {
//         TableName: "tl_restaurant_table",
//         KeyConditionExpression: "restaurant_id= :restaurant_id",
//         ExpressionAttributeValues: {
//             ":restaurant_id": event.restaurant_id
//         }
//     };
//     let details = await query_dynamo(checkIfRestaurantExists);
//     console.log(details);
//     if (details.Count > 0) {
//         let ambienceUrl = event.ambience_url;
//         const existingAmbienceUrls = details.Items[0].ambience_url || [];
//         const updatedAmbienceUrls = existingAmbienceUrls.filter(url => url !== ambienceUrl);

//         let updateTableParams = {
//             TableName: "tl_restaurant_table",
//             Key: {
//                 restaurant_id: details.Items[0].restaurant_id
//             },
//             UpdateExpression: "SET ambience_url= :ambience_url",
//             ExpressionAttributeValues: {
//                 ":ambience_url": updatedAmbienceUrls
//             }
//         };

//         let updation = await update_dynamo(updateTableParams);
//         console.log(updation);
//         if (updation === 'SUCCESS') {
//             let updateInDraftsParams = {
//                 TableName: "tl_restaurant_drafts",
//                 Key: {
//                     restaurant_id: details.Items[0].restaurant_id
//                 },
//                 UpdateExpression: "SET ambience_url= :ambience_url",
//                 ExpressionAttributeValues: {
//                     ":ambience_url": updatedAmbienceUrls
//                 }
//             };

//             let draftsUpdation = await update_dynamo(updateInDraftsParams);
//             if (draftsUpdation === 'SUCCESS') {
//                 let checkIfAmbienceUrlExists = {
//                     TableName: "tl_restaurant_ambience_images",
//                     IndexName: "ambience_url-index",
//                     KeyConditionExpression: "ambience_url= :ambience_url",
//                     ExpressionAttributeValues: {
//                         ":ambience_url": ambienceUrl
//                     }
//                 };

//                 let checkAmbUrlExists = await query_dynamo(checkIfAmbienceUrlExists);
//                 console.log(checkAmbUrlExists);
//                 if (checkAmbUrlExists.Count > 0) {
//                     let deleteUrlParams = {
//                         TableName: "tl_restaurant_ambience_images",
//                         Key: {
//                             ambience_id: checkAmbUrlExists.Items[0].ambience_id
//                         }
//                     };
//                     await delete_dynamo(deleteUrlParams);
//                     return { status: 200, message: "Image deleted successfully!" };
//                 }
//                 else {
//                     return { message: "Invalid operation!" };
//                 }
//             }
//         }
//     }
// }

async function delete_restaurant(event) {
    let checkPermissionParams = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    let details = await query_dynamo(checkPermissionParams);
    if (details.Count > 0 && details.Items[0].user_type === 'ADMIN' || 'RESTAURANT_CURATOR') {
        let deleteParams = {
            TableName: "tl_restaurant_table",
            Key: {
                restaurant_id: event.restaurant_id
            }
        }
        await delete_dynamo(deleteParams);
        return { status: 200, message: "Deleted successfully!" }
    }
    return { message: "Not eligible to perform this operation!" }
}

async function list_posts_of_restaurant(event) {
    console.log("LIST----->", event);
    const input = {
        TableName: "tl_restaurant_posts",
        IndexName: "restaurant_id-index",
        KeyConditionExpression: "restaurant_id= :restaurant_id",
        ExpressionAttributeValues: {
            ":restaurant_id": event.restaurant_id
        }
    }
    const result = await query_dynamo(input);
    return result.Items;
}

/************************************ DEVICE MANAGEMENT ********************************************/

async function list_android_devices(event) {
    const input = {
        TableName: "user_device_details",
        FilterExpression: "os_type= :os_type",
        ExpressionAttributeValues: {
            ":os_type": "Android"
        }
    }
    const result = await scan_dynamo(input);
    return { status: 200, data: result.Items, totalCount: result.Count }
}

async function list_IOS_devices(event) {
    const input = {
        TableName: "user_device_details",
        FilterExpression: "os_type= :os_type",
        ExpressionAttributeValues: {
            ":os_type": "IOS"
        }
    }
    const result = await scan_dynamo(input);
    return { status: 200, data: result.Items, totalCount: result.Count }
}

/************************************ SHERPA(TOUR GUIDE) ********************************************/

async function create_my_profile_for_sherpa(event) {
    console.log(event);
    let checkIfSherpaExists = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id,
            // ":user_type": "SHERPA" || "ADMIN"
        },
        // FilterExpression: "user_type= :user_type"
    }

    let details = await query_dynamo(checkIfSherpaExists);
    console.log(details);
    if (details.Count > 0 && details.Items[0].user_type === 'SHERPA') {
        const createProfileParams = {
            TableName: "tl_sherpa_profiles",
            Item: {
                sherpa_id: uuidv4(),
                sherpa_name: event.sherpa_name,
                about: event.about,
                sherpa_email_id: event.sherpa_email_id,
                phone_number: event.phone_number,
                sherpa_latitude: event.sherpa_latitude,
                sherpa_longitude: event.sherpa_longitude,
                profile_pic_url: event.profile_pic_url,
                sherpa_status: "PENDING",
                created_on: Date.now(),
                created_by: details.Items[0].admin_id,
            }
        }
        let insertion = await insert_into_dynamo(createProfileParams);
        console.log(insertion);
        return { status: 200, message: "Profile creation is successful and sent for approval!" };
    }
    if (details.Count > 0 && details.Items[0].user_type === 'ADMIN') {
        const createProfileParams = {
            TableName: "tl_sherpa_profiles",
            Item: {
                sherpa_id: uuidv4(),
                sherpa_name: event.sherpa_name,
                about: event.about,
                sherpa_email_id: event.sherpa_email_id,
                phone_number: event.phone_number,
                sherpa_latitude: event.sherpa_latitude,
                sherpa_longitude: event.sherpa_longitude,
                profile_pic_url: event.profile_pic_url,
                sherpa_status: "APPROVED",
                created_on: Date.now(),
                created_by: details.Items[0].admin_id,
            }
        }
        let insertion = await insert_into_dynamo(createProfileParams);
        console.log(insertion);
        return { status: 200, message: "Profile created successfully!!" };
    }
    else {
        return { message: "Invalid operation!" };
    }
}

// async function create_my_profile_for_sherpa(event) {
//     let checkAdminParams = {
//         TableName: "tl_admin",
//         KeyConditionExpression: "admin_id= :admin_id",
//         ExpressionAttributeValues: {
//             ":admin_id": event.admin_id
//         }
//     }
//     let details = await query_dynamo(checkAdminParams);
//     if (details.Count > 0 && details.Items[0].user_type === 'ADMIN') {
//         let checkIfSherpaExists = {
//             TableName: "tl_admin",
//             IndexName: "admin_email-index",
//             KeyConditionExpression: "admin_email= :sherpa_email_id",
//             ExpressionAttributeValues: {
//                 ":sherpa_email_id": event.sherpa_email_id
//             }
//         }
//         let sherpaDetails = await query_dynamo(checkIfSherpaExists);
//         if (sherpaDetails > 0) {
//             throw new Error(" Provided email-id already exists in our database!")
//         }
//         const creationParams = {
//             TableName: "tl_sherpa_profiles",
//             Item: {
//                 sherpa_id: uuidv4(),
//                 sherpa_name: event.sherpa_name,
//                 about: event.about,
//                 sherpa_email_id: event.sherpa_email_id,
//                 phone_number: event.phone_number,
//                 sherpa_latitude: event.sherpa_latitude,
//                 sherpa_longitude: event.sherpa_longitude,
//                 profile_pic_url: event.profile_pic_url,
//                 sherpa_status: "PENDING",
//                 created_on: Date.now(),
//                 created_by: details.Items[0].admin_id,
//                 creator_id: details.Items[0].admin_id
//             }
//         }
//         await insert_into_dynamo(creationParams);
//         return { status: 200, message: "Profile created successfully!" }
//     }
//     else {
//         throw new Error("You are not authorized to perform this operation!")
//     }
// }

async function update_sherpa_profile_status(event) {
    console.log("event", event);
    let checkIfAdminExists = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    let adminDetails = await query_dynamo(checkIfAdminExists);
    if (adminDetails.Count > 0 && adminDetails.Items[0].user_type === "ADMIN") {
        let checkIfSherpaExists = {
            TableName: "tl_sherpa_profiles",
            KeyConditionExpression: "sherpa_id= :sherpa_id",
            ExpressionAttributeValues: {
                ":sherpa_id": event.sherpa_id
            }
        }
        let sherpaDetails = await query_dynamo(checkIfSherpaExists);
        if (sherpaDetails.Count > 0 && sherpaDetails.Items[0].sherpa_status === "PENDING") {

            // let decision = event.admin_decision
            if (event.admin_decision == "APPROVE") {
                let updateParams = {
                    TableName: "tl_sherpa_profiles",
                    Key: {
                        sherpa_id: sherpaDetails.Items[0].sherpa_id
                    },
                    UpdateExpression: "SET sherpa_status= :sherpa_status",
                    ExpressionAttributeValues: {
                        ":sherpa_status": "APPROVED"
                    }
                }
                await update_dynamo(updateParams);
                return { status: 200, message: "Approved successfully!" }
            }
            if (event.admin_decision == "REJECT") {
                let deleteParams = {
                    TableName: "tl_sherpa_profiles",
                    Key: {
                        sherpa_id: sherpaDetails.Items[0].sherpa_id
                    }
                }
                await delete_dynamo(deleteParams);
                return { status: 200, message: "Rejected and deleted successfully!" }
            }
        }
        else {
            return { message: "Sherpa does not exist or you're trying an invalid operation" }
        }
    }
}

async function edit_sherpa_profile(event) {
    let checkAdminPermissions = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    let adminDetails = await query_dynamo(checkAdminPermissions);
    if (adminDetails.Count > 0 && adminDetails.Items[0].user_type === "SHERPA") {
        const checkIfSherpaExists = {
            TableName: "tl_sherpa_profiles",
            KeyConditionExpression: "sherpa_id= :sherpa_id",
            ExpressionAttributeValues: {
                ":sherpa_id": event.sherpa_id
            }
        }

        let details = await query_dynamo(checkIfSherpaExists);
        if (details.Count > 0) {
            let updateExpression = "SET ";
            let expressionAttributeValues = {};

            if (event.sherpa_name !== undefined) {
                updateExpression += "sherpa_name = :sherpa_name, ";
                expressionAttributeValues[":sherpa_name"] = event.sherpa_name;
            }
            if (event.profile_pic_url !== undefined) {
                updateExpression += "profile_pic_url = :profile_pic_url, ";
                expressionAttributeValues[":profile_pic_url"] = event.profile_pic_url;
            }
            if (event.sherpa_email_id !== undefined) {
                updateExpression += "sherpa_email_id = :sherpa_email_id, ";
                expressionAttributeValues[":sherpa_email_id"] = event.sherpa_email_id;
            }
            if (event.phone_number !== undefined) {
                updateExpression += "phone_number = :phone_number, ";
                expressionAttributeValues[":phone_number"] = event.phone_number;
            }
            if (event.about !== undefined) {
                updateExpression += "about = :about, ";
                expressionAttributeValues[":about"] = event.about;
            }
            if (event.sherpa_longitude !== undefined) {
                updateExpression += "sherpa_longitude = :sherpa_longitude, ";
                expressionAttributeValues[":sherpa_longitude"] = event.sherpa_longitude;
            }
            if (event.sherpa_latitude !== undefined) {
                updateExpression += "sherpa_latitude = :sherpa_latitude, ";
                expressionAttributeValues[":sherpa_latitude"] = event.sherpa_latitude;
            }

            updateExpression += "sherpa_status = :sherpa_status, ";
            expressionAttributeValues[":sherpa_status"] = "PENDING";

            updateExpression = updateExpression.slice(0, -2);



            let editParams = {
                TableName: "tl_sherpa_profiles",
                Key: {
                    sherpa_id: details.Items[0].sherpa_id
                },
                UpdateExpression: updateExpression,
                ExpressionAttributeValues: expressionAttributeValues
            }
            await update_dynamo(editParams);
            return { status: 200, message: "Edited successfully and sent for approval!" }
        }
    }
    if (adminDetails.Count > 0 && adminDetails.Items[0].user_type === "ADMIN") {
        const checkIfSherpaExists = {
            TableName: "tl_sherpa_profiles",
            KeyConditionExpression: "sherpa_id= :sherpa_id",
            ExpressionAttributeValues: {
                ":sherpa_id": event.sherpa_id
            }
        }

        let details = await query_dynamo(checkIfSherpaExists);
        if (details.Count > 0) {
            let updateExpression = "SET ";
            let expressionAttributeValues = {};

            if (event.sherpa_name !== undefined) {
                updateExpression += "sherpa_name = :sherpa_name, ";
                expressionAttributeValues[":sherpa_name"] = event.sherpa_name;
            }
            if (event.profile_pic_url !== undefined) {
                updateExpression += "profile_pic_url = :profile_pic_url, ";
                expressionAttributeValues[":profile_pic_url"] = event.profile_pic_url;
            }
            if (event.sherpa_email_id !== undefined) {
                updateExpression += "sherpa_email_id = :sherpa_email_id, ";
                expressionAttributeValues[":sherpa_email_id"] = event.sherpa_email_id;
            }
            if (event.phone_number !== undefined) {
                updateExpression += "phone_number = :phone_number, ";
                expressionAttributeValues[":phone_number"] = event.phone_number;
            }
            if (event.about !== undefined) {
                updateExpression += "about = :about, ";
                expressionAttributeValues[":about"] = event.about;
            }
            if (event.sherpa_longitude !== undefined) {
                updateExpression += "sherpa_longitude = :sherpa_longitude, ";
                expressionAttributeValues[":sherpa_longitude"] = event.sherpa_longitude;
            }
            if (event.sherpa_latitude !== undefined) {
                updateExpression += "sherpa_latitude = :sherpa_latitude, ";
                expressionAttributeValues[":sherpa_latitude"] = event.sherpa_latitude;
            }

            updateExpression += "sherpa_status = :sherpa_status, ";
            expressionAttributeValues[":sherpa_status"] = "APPROVED";

            updateExpression = updateExpression.slice(0, -2);



            let editParams = {
                TableName: "tl_sherpa_profiles",
                Key: {
                    sherpa_id: details.Items[0].sherpa_id
                },
                UpdateExpression: updateExpression,
                ExpressionAttributeValues: expressionAttributeValues
            }
            await update_dynamo(editParams);
            return { status: 200, message: "Edited successfully!!" }
        }
    }
    else {
        return { message: "Sherpa does not exist" };
    }
}

async function list_pending_profiles_of_sherpas(event) {
    let input = {
        TableName: "tl_sherpa_profiles",
        FilterExpression: "sherpa_status= :sherpa_status",
        ExpressionAttributeValues: {
            ":sherpa_status": "PENDING"
        }
    }
    let result = await scan_dynamo(input);
    return { status: 200, data: result.Items, totalCount: result.Count }

}

async function list_all_approved_sherpas(event) {
    let input = {
        TableName: "tl_sherpa_profiles"
    }
    let result = await scan_dynamo(input);
    return { status: 200, data: result.Items, totalCount: result.Count }
}

async function delete_sherpa(event) {
    let permissionParams = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    let details = await query_dynamo(permissionParams);
    if (details.Count > 0 && details.Items[0].user_type === 'ADMIN' || 'SHERPA') {
        let deletionParams = {
            TableName: "tl_sherpa_profiles",
            Key: {
                sherpa_id: event.sherpa_id
            }
        }
        let deletion = await delete_dynamo(deletionParams);
        if (deletion === 'SUCCESS') {
            return { status: 200, message: "Deletion successful!" };
        }
        else {
            return { message: "Error occured!" }
        }
    }
    return { message: "You are not authorized to perform this operation!" }
}

async function list_my_restaurant(event) {
    const input = {
        TableName: "tl_restaurant_table",
        IndexName: "creator_id-index",
        KeyConditionExpression: "creator_id= :creator_id",
        ExpressionAttributeValues: {
            ":creator_id": event.admin_id
        }
    }
    let result = await query_dynamo(input);
    if (result.Count === 0) {
        throw new Error("No restaurants found!");
    }
    return { status: 200, data: result.Items, totalCount: result.Count }

}

async function list_pranavs_povs(event) {
    const input = {
        TableName: "tl_global_pov",
        FilterExpression: "creator_name = :creator_name AND pov_status = :pov_status",
        ExpressionAttributeValues: {
            ":creator_name": "Pranav",
            ":pov_status": "APPROVED"
        }
    };
    const result = await scan_dynamo(input);
    return { status: 200, totalCount: result.Count };
}

async function enable_or_disable_sherpa_listings(event) {
    console.log("EVENT:", event);
    const checkAdminExists = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    let details = await query_dynamo(checkAdminExists);
    if (details.Count > 0 && details.Items[0].user_type === 'ADMIN') {
        const updateDecisionParams = {
            TableName: "tl_admin_decision",
            Key: {
                decision_id: "78f1a4d1-cc43-4376-ad25-c406c54284f1"
            },
            UpdateExpression: "SET admin_decision= :admin_decision, done_by= :done_by , done_on= :done_on",
            ExpressionAttributeValues: {
                ":admin_decision": event.admin_decision,
                ":done_by": details.Items[0].admin_id,
                ":done_on": Date.now()
            }
        }

        await update_dynamo(updateDecisionParams);
        return { status: 200, message: `${event.admin_decision} operation successful!` }
    }
}

async function display_sherpa_listing_decision(event) {
    const input = {
        TableName: "tl_admin_decision",
    };
    const result = await scan_dynamo(input);
    return { status: 200, data: result.Items[0].admin_decision };
}

async function enable_or_disable_restaurant_listings(event) {
    console.log("EVENT:", event);
    const checkAdminExists = {
        TableName: "tl_admin",
        KeyConditionExpression: "admin_id= :admin_id",
        ExpressionAttributeValues: {
            ":admin_id": event.admin_id
        }
    }
    let details = await query_dynamo(checkAdminExists);
    if (details.Count > 0 && details.Items[0].user_type === 'ADMIN') {
        const updateDecisionParams = {
            TableName: "tl_restaurant_decision",
            Key: {
                decision_id: "ab2c950e-8e07-42de-9f64-4fe85af895d2"
            },
            UpdateExpression: "SET admin_decision= :admin_decision, done_by= :done_by , done_on= :done_on",
            ExpressionAttributeValues: {
                ":admin_decision": event.admin_decision,
                ":done_by": details.Items[0].admin_id,
                ":done_on": Date.now()
            }
        }

        await update_dynamo(updateDecisionParams);
        return { status: 200, message: `${event.admin_decision} operation successful!` }
    }
}

async function display_restaurant_listing_decision(event) {
    const input = {
        TableName: "tl_restaurant_decision"
    }
    const result = await scan_dynamo(input);
    return { status: 200, data: result.Items[0].admin_decision }
}

async function list_my_sherpa_creations(event) {
    const input = {
        TableName: "tl_sherpa_profiles",
        IndexName: "created_by-index",
        KeyConditionExpression: "created_by= :created_by",
        ExpressionAttributeValues: {
            ":created_by": event.admin_id
        }
    }
    let result = await query_dynamo(input);
    return { status: 200, data: result.Items, totalCount: result.Count }
}


export const handler = async (event) => {
    switch (event.command) {
        case "create_admin":
            return await create_admin(event);

        case "create_agent":
            return await create_agent(event);

        case "create_agent_subscription":
            return await create_agent_subscription(event);

        case "get_admin":
            return await get_admin(event);

        case "list_users":
            return await list_users(event);

        case "list_agent_travelogues":
            return await list_agent_travelogues(event);

        case "list_pov":
            return await list_pov(event);

        case "list_post":
            return await list_post(event);

        case "Reject_pending_travelogues":
            return await Reject_pending_travelogues(event);

        case "approve_pending_travelogues":
            return await approve_pending_travelogues(event);

        case "list_all_pending_approval_travelogues":
            return await list_all_pending_approval_travelogues(event);

        case "list_all_rejected_travelogues":
            return await list_all_rejected_travelogues(event);

        case "list_agent_pending_approval_travelogues":
            return await list_agent_pending_approval_travelogues(event);

        case "list_agent_rejected_travelogues":
            return await list_agent_rejected_travelogues(event);

        case "list_all_agents":
            return await list_all_agents(event);

        case "list_all_agent_travelogues":
            return await list_all_agent_travelogues(event);

        case "deactivate_agent":
            return await deactivate_agent(event);

        case "list_approved_agent_travelogues":
            return await list_approved_agent_travelogues(event);

        case "list_all_approved_agent_travelogues":
            return await list_all_approved_agent_travelogues(event);

        case "list_all_travelogues":
            return await list_all_travelogues(event);

        case "list_all_bms_users":
            return await list_all_bms_users(event);


            /************************************ POV ********************************************/

        case "create_pov":
            return await create_pov(event);

        case "list_users_pov":
            return await list_users_pov(event);

        case "update_user_pov_status":
            return await update_user_pov_status(event);

        case "list_global_pov":
            return await list_global_pov(event);

        case "create_post":
            return await create_post(event);

        case "delete_admin":
            return await delete_admin(event);

        case "pov_deletion":
            return await pov_deletion(event);

        case "list_global_posts":
            return await list_global_posts(event);

        case "edit_global_povs":
            return await edit_global_povs(event);

        case "delete_post":
            return await delete_post(event);

        case 'list_my_pov':
            return await list_my_pov(event);

        case "update_curator_pov_status":
            return await update_curator_pov_status(event);

        case "list_curators_pov":
            return await list_curators_pov(event);

        case "edit_pov_for_pov_curator":
            return await edit_pov_for_pov_curator(event);

        case "list_user_devices_details":
            return await list_user_devices_details(event);

        case "delete_post_for_pov_curator":
            return await delete_post_for_pov_curator(event);

        case "pov_deletion_for_pov_curator":
            return await pov_deletion_for_pov_curator(event);


            /************************************ RESTAURANT ********************************************/

        case "create_restaurant":
            return await create_restaurant(event);

        case "create_post_for_restaurant":
            return await create_post_for_restaurant(event);

        case "delete_post_for_restaurant":
            return await delete_post_for_restaurant(event);

            // case "upload_menu_images":
            //     return await upload_menu_images(event);

            // case "upload_food_images":
            //     return await upload_food_images(event);

            // case "upload_ambience_images":
            //     return await upload_ambience_images(event);

        case "list_approved_restaurants":
            return await list_approved_restaurants(event);

        case "list_pending_restaurants":
            return await list_pending_restaurants(event);

        case "approve_or_reject_restaurant":
            return await approve_or_reject_restaurant(event);

        case "edit_restaurant":
            return await edit_restaurant(event);

            // case "delete_menu_images_for_restaurant":
            //     return await delete_menu_images_for_restaurant(event);

            // case "delete_food_images_for_restaurant":
            //     return await delete_food_images_for_restaurant(event);

            // case "delete_ambience_images_for_restaurant":
            //     return await delete_ambience_images_for_restaurant(event);

        case "delete_restaurant":
            return await delete_restaurant(event);

        case "list_post_of_restaurant":
            return await list_posts_of_restaurant(event);


            /************************************ DEVICE MANAGEMENT ********************************************/

        case "list_android_devices":
            return await list_android_devices(event);

        case "list_IOS_devices":
            return await list_IOS_devices(event);

            /************************************ SHERPA(TOUR GUIDE) ********************************************/


        case "create_my_profile_for_sherpa":
            return await create_my_profile_for_sherpa(event);

        case "update_sherpa_profile_status":
            return update_sherpa_profile_status(event);

        case "edit_sherpa_profile":
            return await edit_sherpa_profile(event);

        case "list_pending_profiles_of_sherpas":
            return await list_pending_profiles_of_sherpas(event);

        case "list_all_approved_sherpas":
            return await list_all_approved_sherpas(event);

        case "delete_sherpa":
            return await delete_sherpa(event);

        case "list_pranavs_povs":
            return await list_pranavs_povs(event);

        case "list_my_restaurant":
            return await list_my_restaurant(event);

        case "enable_or_disable_sherpa_listings":
            return enable_or_disable_sherpa_listings(event);

        case "display_sherpa_listing_decision":
            return await display_sherpa_listing_decision(event);

        case "enable_or_disable_restaurant_listings":
            return await enable_or_disable_restaurant_listings(event);

        case "display_restaurant_listing_decision":
            return await display_restaurant_listing_decision(event);

        case "list_my_sherpa_creations":
            return await list_my_sherpa_creations(event);

        default:
            throw new Error("Commad Not Found!");

    }
};
